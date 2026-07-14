"""Integration tests for Flask API routes."""
import io
import uuid
from pathlib import Path

import pytest

from tests.conftest import make_token

# `client` and `auth_headers` fixtures come from conftest.py


@pytest.fixture()
def pipeline_auth():
    """
    (headers, uid) with a UNIQUE sub, unlike the shared `auth_headers`
    fixture. core/sessions.py's rate_limit keys its call-count bucket by uid
    ONLY (pooled across every rate-limited route, not per-route), so chaining
    several /upload -> /train -> /predict calls under the shared default
    test uid would eventually trip /train's max_calls=5 ceiling purely from
    unrelated tests' traffic. A fresh uid per test sidesteps that without
    touching the app's rate limiter.
    """
    uid = str(uuid.uuid4())
    headers = {"Authorization": "Bearer " + make_token(sub=uid)}
    return headers, uid


class TestHealthRoute:
    def test_health_ok(self, client):
        res = client.get('/health')
        assert res.status_code == 200
        data = res.get_json()
        assert data['status'] == 'ok'
        assert 'active_sessions' in data


class TestIndexRoute:
    def test_index_returns_html(self, client):
        res = client.get('/')
        assert res.status_code == 200
        assert b'SmartShiftAI' in res.data


class TestCsrfTokenRoute:
    def test_csrf_token_returned(self, client):
        res = client.get('/csrf-token')
        assert res.status_code == 200
        data = res.get_json()
        assert 'csrf_token' in data


class TestUploadRoute:
    def _make_csv(self):
        lines = ['Date,Day,Customers,Sales,Workers,Time Slot']
        for i in range(30):
            from datetime import date, timedelta
            d = date(2024, 1, 1) + timedelta(days=i)
            dow = d.strftime('%A')
            lines.append(f'{d},{dow},{50+i},{500+i*10},{2+i%3},10:00 AM-12:00 PM')
        return '\n'.join(lines).encode()

    def test_upload_requires_auth(self, client):
        data = {'file': (io.BytesIO(self._make_csv()), 'test.csv')}
        res  = client.post('/upload', data=data, content_type='multipart/form-data')
        assert res.status_code == 401

    def test_upload_valid_csv(self, client, auth_headers):
        data = {'file': (io.BytesIO(self._make_csv()), 'test.csv')}
        res  = client.post('/upload', data=data, content_type='multipart/form-data',
                           headers=auth_headers)
        assert res.status_code == 200
        body = res.get_json()
        assert body['status'] == 'ok'
        assert body['row_count'] == 30

    def test_upload_missing_file(self, client, auth_headers):
        res = client.post('/upload', data={}, content_type='multipart/form-data',
                          headers=auth_headers)
        assert res.status_code == 400

    def test_upload_wrong_columns(self, client, auth_headers):
        bad_csv = b'A,B,C\n1,2,3\n4,5,6\n'
        data    = {'file': (io.BytesIO(bad_csv), 'bad.csv')}
        res     = client.post('/upload', data=data, content_type='multipart/form-data',
                              headers=auth_headers)
        assert res.status_code in (400, 422)
        assert 'error' in res.get_json()


class TestNotificationsRoute:
    def test_notifications_requires_auth(self, client):
        res = client.get('/notifications')
        assert res.status_code == 401

    def test_notifications_empty_initially(self, client, auth_headers):
        res = client.get('/notifications', headers=auth_headers)
        assert res.status_code == 200
        data = res.get_json()
        assert 'notifications' in data
        assert isinstance(data['notifications'], list)


class TestResetRoute:
    def test_reset_requires_auth(self, client):
        res = client.post('/reset')
        assert res.status_code == 401

    def test_reset_ok(self, client, auth_headers):
        res = client.post('/reset', headers=auth_headers)
        assert res.status_code == 200
        assert res.get_json()['status'] == 'reset'


class TestModelSurvivesColdContainer:
    """
    Regression test for the Vercel crash: `/train` wrote its .pkl only to
    local disk (MODEL_DIR), which is wiped between serverless invocations —
    a /predict request landing on a different (or simply re-started)
    container would find no model file and fail. Simulate that here by
    deleting the trained model's local file out from under the session
    (exactly what an empty /tmp on a new container would look like) and
    confirming /predict still works because it hydrates the model back out
    of (fake) Supabase Storage.
    """

    def _make_csv(self):
        lines = ['Date,Day,Customers,Sales,Workers,Time Slot']
        for i in range(30):
            from datetime import date, timedelta
            d = date(2024, 1, 1) + timedelta(days=i)
            dow = d.strftime('%A')
            lines.append(f'{d},{dow},{50+i},{500+i*10},{2+i%3},10:00 AM-12:00 PM')
        return '\n'.join(lines).encode()

    def test_predict_survives_local_model_file_loss(self, client, pipeline_auth):
        headers, _uid = pipeline_auth
        data = {'file': (io.BytesIO(self._make_csv()), 'test.csv')}
        res = client.post('/upload', data=data, content_type='multipart/form-data', headers=headers)
        assert res.status_code == 200, res.get_json()

        res = client.post('/train', headers=headers)
        assert res.status_code == 200, res.get_json()
        model_path = res.get_json()['model_path']
        assert Path(model_path).exists()

        # Simulate a cold serverless container: the local .pkl is just gone.
        Path(model_path).unlink()
        assert not Path(model_path).exists()

        res = client.post('/predict', headers=headers)
        assert res.status_code == 200, res.get_json()
        assert res.get_json()['status'] == 'ok'

    def test_predict_without_token_still_fails_when_model_missing(self, client):
        """Anonymous sessions have no Supabase user id to hydrate from, so a
        missing model must still fail cleanly (no crash) rather than 200."""
        res = client.post('/predict')
        assert res.status_code == 401


class TestCsvSurvivesColdContainer:
    """
    Regression test for the same class of bug on the CSV side: /upload wrote
    the cleaned CSV only to a local temp file (TEMP_DIR), so a /train (or
    /predict) request landing on a different serverless container than the
    /upload that preceded it would find no CSV and fail with "No uploaded
    data found." Simulate that by deleting the local CSV out from under the
    session and confirming /train and /predict both still work because they
    hydrate it back out of (fake) Supabase Storage.
    """

    def _make_csv(self):
        lines = ['Date,Day,Customers,Sales,Workers,Time Slot']
        for i in range(30):
            from datetime import date, timedelta
            d = date(2024, 1, 1) + timedelta(days=i)
            dow = d.strftime('%A')
            lines.append(f'{d},{dow},{50+i},{500+i*10},{2+i%3},10:00 AM-12:00 PM')
        return '\n'.join(lines).encode()

    def _delete_local_csv(self, uid):
        """Simulate a cold serverless container: reach into the in-memory
        session store (the only place the local temp path is known) and
        delete the CSV file out from under it, without touching the dict
        entry itself — exactly what an empty /tmp on a fresh container
        looks like from the route's point of view."""
        from core.sessions import _SESSION_STORE
        session_data = _SESSION_STORE[uid]
        Path(session_data["csv_path"]).unlink()
        assert not Path(session_data["csv_path"]).exists()

    def test_train_survives_local_csv_file_loss(self, client, pipeline_auth):
        headers, uid = pipeline_auth
        data = {'file': (io.BytesIO(self._make_csv()), 'test.csv')}
        res = client.post('/upload', data=data, content_type='multipart/form-data', headers=headers)
        assert res.status_code == 200, res.get_json()

        self._delete_local_csv(uid)

        res = client.post('/train', headers=headers)
        assert res.status_code == 200, res.get_json()

    def test_predict_survives_local_csv_and_model_file_loss(self, client, pipeline_auth):
        headers, uid = pipeline_auth
        data = {'file': (io.BytesIO(self._make_csv()), 'test.csv')}
        res = client.post('/upload', data=data, content_type='multipart/form-data', headers=headers)
        assert res.status_code == 200, res.get_json()

        res = client.post('/train', headers=headers)
        assert res.status_code == 200, res.get_json()
        model_path = res.get_json()['model_path']

        # Both the CSV and the model are "gone" — as if /predict landed on a
        # brand-new container that never ran /upload or /train.
        self._delete_local_csv(uid)
        Path(model_path).unlink()

        res = client.post('/predict', headers=headers)
        assert res.status_code == 200, res.get_json()
