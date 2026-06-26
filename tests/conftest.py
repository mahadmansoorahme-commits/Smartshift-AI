"""
Shared pytest fixtures.

Sets a known JWT secret BEFORE the app/config is imported so tests can forge
valid Supabase access tokens without depending on the real .env value.
"""
import os
import sys
import time

# Must run before `import app` (which imports config -> core.auth).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("FLASK_DEBUG", "1")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-smartshift")

import jwt  # noqa: E402
import pytest  # noqa: E402

TEST_SECRET = os.environ["SUPABASE_JWT_SECRET"]


def make_token(sub="11111111-1111-1111-1111-111111111111",
               email="tester@example.com",
               exp_delta=3600,
               secret=None,
               aud="authenticated"):
    """Forge a Supabase-style access token for tests."""
    payload = {
        "sub":   sub,
        "email": email,
        "role":  "authenticated",
        "aud":   aud,
        "exp":   int(time.time()) + exp_delta,
    }
    return jwt.encode(payload, secret or TEST_SECRET, algorithm="HS256")


@pytest.fixture()
def auth_headers():
    """Authorization header carrying a valid forged token."""
    return {"Authorization": "Bearer " + make_token()}


@pytest.fixture()
def client():
    import app as app_module
    app_module.app.config["TESTING"]               = True
    app_module.app.config["WTF_CSRF_ENABLED"]      = False
    app_module.app.config["SESSION_COOKIE_SECURE"] = False
    with app_module.app.test_client() as c:
        yield c
