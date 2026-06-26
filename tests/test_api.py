"""Integration tests for Flask API routes."""
import io

# `client` and `auth_headers` fixtures come from conftest.py


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
        lines = ['Date,Day,Customers,Sales,Workers']
        for i in range(30):
            from datetime import date, timedelta
            d = date(2024, 1, 1) + timedelta(days=i)
            dow = d.strftime('%A')
            lines.append(f'{d},{dow},{50+i},{500+i*10},{2+i%3}')
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
