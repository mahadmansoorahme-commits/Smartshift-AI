"""
Shared pytest fixtures.

Sets a known JWT secret BEFORE the app/config is imported so tests can forge
valid Supabase access tokens without depending on the real .env value.
"""
import itertools
import os
import sys
import time
from collections import defaultdict

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


class FakeSupabase:
    """
    In-memory stand-in for db/client.py's Supabase REST + Storage calls.

    Backs onto plain dicts keyed the same way real Postgres rows / Storage
    objects would be (per user_id / per bucket+path), so it exercises the
    real save_upload/hydrate_csv and save_model/hydrate_model orchestration
    in core/persistence.py without any network access.
    """

    def __init__(self):
        self.tables  = defaultdict(list)
        self.storage = {}
        self._ids    = itertools.count(1)

    def insert_row(self, table, token, row):
        new_row = dict(row)
        new_row.setdefault("id", str(next(self._ids)))
        new_row.setdefault("trained_at", "2026-01-01T00:00:00Z")
        self.tables[table].append(new_row)
        return new_row

    def latest_row(self, table, token, user_id, order_col="created_at"):
        rows = [r for r in self.tables[table] if r.get("user_id") == user_id]
        return rows[-1] if rows else None

    def upload_object(self, bucket, path, token, content, content_type="application/octet-stream"):
        self.storage[(bucket, path)] = content

    def download_object(self, bucket, path, token):
        return self.storage.get((bucket, path))

    def delete_object(self, bucket, path, token):
        self.storage.pop((bucket, path), None)


@pytest.fixture(autouse=True)
def fake_supabase(monkeypatch):
    """
    Auto-applied to every test: gives db.client a working (but fake, in-memory)
    Supabase backend so routes that persist the CSV or the trained model
    don't need a real Supabase project to run in CI, while still exercising
    the real save_*/hydrate_* code paths in core/persistence.py.
    """
    from db import client as db_client

    fake = FakeSupabase()
    monkeypatch.setattr(db_client, "insert_row", fake.insert_row)
    monkeypatch.setattr(db_client, "latest_row", fake.latest_row)
    monkeypatch.setattr(db_client, "upload_object", fake.upload_object)
    monkeypatch.setattr(db_client, "download_object", fake.download_object)
    monkeypatch.setattr(db_client, "delete_object", fake.delete_object)
    return fake
