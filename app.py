"""
SmartShiftAI — app.py
Thin application factory: wires Flask, CSRF, session lifecycle,
security headers, and registers all route Blueprints.
"""

import os

from flask import Flask, Response, g, jsonify, render_template, request
from flask_wtf.csrf import CSRFProtect, generate_csrf

import json
import urllib.error
import urllib.request

from config import (
    Config, CSP, _MAX_SESSIONS,
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
)
from core.auth import get_current_user, require_auth
from core.sessions import (
    active_session_count,
    delete_session,
    get_or_create_session,
    push_notification,
    set_session_cookie,
)
from routes.upload   import upload_bp
from routes.train    import train_bp
from routes.forecast import forecast_bp
from routes.schedule import schedule_bp
from routes.costs    import costs_bp
from routes.history  import history_bp

# ---------------------------------------------------------------------------
# Create app
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config.from_object(Config)

csrf = CSRFProtect(app)

# ---------------------------------------------------------------------------
# Register Blueprints
# ---------------------------------------------------------------------------
app.register_blueprint(upload_bp)
app.register_blueprint(train_bp)
app.register_blueprint(forecast_bp)
app.register_blueprint(schedule_bp)
app.register_blueprint(costs_bp)
app.register_blueprint(history_bp)

# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------
@app.after_request
def apply_security_headers(response):
    response.headers["X-Frame-Options"]         = "DENY"
    response.headers["X-Content-Type-Options"]   = "nosniff"
    response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]       = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"]  = CSP
    # Enforce HTTPS for a year once served over TLS in production.
    if request.is_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ---------------------------------------------------------------------------
# Session lifecycle — resolve session before each request
# ---------------------------------------------------------------------------
@app.before_request
def load_session():
    # If a valid Supabase token is present, key the session by the real user id
    # so each logged-in user's data is fully isolated to their account.
    user = get_current_user()
    g.user          = user
    g.authenticated = user is not None

    forced_uid           = user["id"] if user else None
    uid, session_data    = get_or_create_session(forced_uid)
    g.uid     = uid
    g.session = session_data


@app.after_request
def persist_session_cookie(response):
    # Only anonymous (not-logged-in) visitors need the fallback cookie.
    if not getattr(g, "authenticated", False) and getattr(g, "uid", None):
        set_session_cookie(response, g.uid)
    return response

# ---------------------------------------------------------------------------
# Core utility routes
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/app-config.js", methods=["GET"])
def app_config_js():
    """Expose public Supabase config to the browser (anon key is public)."""
    js = (
        "window.SS_CONFIG = {{"
        '  SUPABASE_URL: "{url}",'
        '  SUPABASE_ANON_KEY: "{key}"'
        "}};"
    ).format(url=SUPABASE_URL, key=SUPABASE_ANON_KEY)
    return Response(js, mimetype="application/javascript")


@app.route("/csrf-token", methods=["GET"])
def csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


@app.route("/auth/me", methods=["GET"])
def auth_me():
    """Report whether the backend recognises the caller's Supabase token."""
    if g.get("user"):
        return jsonify({"authenticated": True, "user": g.user})
    return jsonify({"authenticated": False}), 200


@app.route("/auth/logout", methods=["POST"])
@require_auth
def auth_logout():
    """Drop the user's server-side in-memory session (and its temp files)."""
    delete_session(g.uid)
    return jsonify({"status": "ok"})


@app.route("/account/delete", methods=["POST"])
@require_auth
def account_delete():
    """
    Fully delete the user's auth account (cascades all their DB rows).
    Requires SUPABASE_SERVICE_ROLE_KEY to be configured; otherwise returns 501
    and the frontend falls back to wiping the user's data rows.
    """
    # Clean up server-side session/files regardless of outcome.
    delete_session(g.uid)

    if not (SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL):
        return jsonify({
            "error": "Account deletion not configured on the server "
                     "(set SUPABASE_SERVICE_ROLE_KEY)."
        }), 501

    url = f"{SUPABASE_URL}/auth/v1/admin/users/{g.uid}"
    req = urllib.request.Request(url, method="DELETE", headers={
        "apikey":        SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status in (200, 204):
                return jsonify({"status": "deleted"})
            return jsonify({"error": f"Delete failed (HTTP {resp.status})."}), 502
    except urllib.error.HTTPError as exc:
        return jsonify({"error": f"Delete failed (HTTP {exc.code})."}), 502
    except urllib.error.URLError as exc:
        return jsonify({"error": f"Could not reach Supabase: {exc.reason}"}), 502


@app.route("/reset", methods=["POST"])
@require_auth
def reset_session():
    uid = g.uid
    delete_session(uid)
    return jsonify({"status": "reset", "uid_cleared": uid[:8] + "…"})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":          "ok",
        "active_sessions": active_session_count(),
        "max_sessions":    _MAX_SESSIONS,
    })

# ---------------------------------------------------------------------------
# Notification routes
# ---------------------------------------------------------------------------
@app.route("/notifications", methods=["GET"])
@require_auth
def notifications():
    notes = sorted(
        g.session.get("notifications", []),
        key=lambda n: n.get("timestamp", 0),
        reverse=True,
    )
    return jsonify({"notifications": notes, "count": len(notes)})


@app.route("/clear_notifications", methods=["POST"])
@require_auth
def clear_notifications():
    g.session["notifications"] = []
    return jsonify({"status": "ok", "cleared": True})

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    debug = bool(os.environ.get("FLASK_DEBUG", False))
    # Default port 3000 to match the Supabase Site URL / redirect URLs.
    # Override with the PORT environment variable if needed.
    port = int(os.environ.get("PORT", 3000))
    app.run(debug=debug, host="0.0.0.0", port=port)
