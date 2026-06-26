"""Unit + integration tests for Supabase JWT auth (core/auth.py)."""
from tests.conftest import make_token, TEST_SECRET

import app as app_module
from core.auth import verify_token, get_current_user


class TestVerifyToken:
    def test_valid_token(self):
        claims = verify_token(make_token(sub="abc-123", email="a@b.com"))
        assert claims is not None
        assert claims["sub"] == "abc-123"
        assert claims["email"] == "a@b.com"

    def test_expired_token(self):
        assert verify_token(make_token(exp_delta=-10)) is None

    def test_bad_signature(self):
        assert verify_token(make_token(secret="the-wrong-secret")) is None

    def test_wrong_audience(self):
        assert verify_token(make_token(aud="anon")) is None

    def test_garbage_token(self):
        assert verify_token("not.a.jwt") is None

    def test_empty_token(self):
        assert verify_token("") is None


class TestGetCurrentUser:
    def test_no_header(self):
        with app_module.app.test_request_context("/"):
            assert get_current_user() is None

    def test_valid_header(self):
        tok = make_token(sub="user-9", email="u9@x.com")
        with app_module.app.test_request_context("/", headers={"Authorization": f"Bearer {tok}"}):
            user = get_current_user()
            assert user is not None
            assert user["id"] == "user-9"
            assert user["email"] == "u9@x.com"

    def test_malformed_header(self):
        with app_module.app.test_request_context("/", headers={"Authorization": "Token xyz"}):
            assert get_current_user() is None


class TestRequireAuthRoute:
    def test_protected_route_blocks_anonymous(self, client):
        assert client.get("/notifications").status_code == 401

    def test_protected_route_allows_valid_token(self, client, auth_headers):
        assert client.get("/notifications", headers=auth_headers).status_code == 200

    def test_protected_route_rejects_expired(self, client):
        tok = make_token(exp_delta=-5)
        res = client.get("/notifications", headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 401


class TestAuthMeRoute:
    def test_auth_me_anonymous(self, client):
        res = client.get("/auth/me")
        assert res.status_code == 200
        assert res.get_json()["authenticated"] is False

    def test_auth_me_authenticated(self, client, auth_headers):
        res = client.get("/auth/me", headers=auth_headers)
        assert res.status_code == 200
        body = res.get_json()
        assert body["authenticated"] is True
        assert body["user"]["email"] == "tester@example.com"
