"""
serve.py — production entry point (waitress WSGI server).

The Flask dev server (`python app.py`) is for local development only.
For a real deployment run:

    # leave FLASK_DEBUG UNSET so cookies are Secure and debug is off
    python serve.py

Put this behind an HTTPS reverse proxy (nginx / Caddy / a PaaS) so traffic —
including the Supabase access token — is always encrypted.
"""
import os

from waitress import serve

from app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print(f"SmartShiftAI (production / waitress) on http://0.0.0.0:{port}")
    serve(app, host="0.0.0.0", port=port, threads=8)
