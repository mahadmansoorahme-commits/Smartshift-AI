/* ==========================================================================
   02-api.js — CSRF helpers and fetch wrappers
   ========================================================================== */
async function fetchCsrfToken() {
  try {
    const res  = await fetch('/csrf-token');
    const data = await res.json();
    State.csrfToken = data.csrf_token;
  } catch (e) {
    console.warn('CSRF fetch failed:', e);
  }
}

/* Authorization header carrying the Supabase access token (JWT), if logged in. */
function authHeaders(extra = {}) {
  const token = (typeof getAccessToken === 'function') ? getAccessToken() : null;
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

function csrfHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-CSRFToken': State.csrfToken || '',
    ...authHeaders(),
    ...extra,
  };
}

/* Run a fetch; on HTTP 401 refresh the token once and retry, else sign out. */
async function _fetchWithAuth(doFetch) {
  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = (typeof forceRefresh === 'function') ? await forceRefresh() : false;
    if (refreshed) res = await doFetch();
    if (res.status === 401 && typeof onAuthExpired === 'function') onAuthExpired();
  }
  return res;
}

async function apiPost(url, body = {}) {
  if (!State.csrfToken) await fetchCsrfToken();
  return _fetchWithAuth(() =>
    fetch(url, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(body) }));
}

async function apiPostForm(url, formData) {
  if (!State.csrfToken) await fetchCsrfToken();
  return _fetchWithAuth(() =>
    fetch(url, { method: 'POST', headers: { 'X-CSRFToken': State.csrfToken || '', ...authHeaders() }, body: formData }));
}

/* GET helper that also carries the auth token (used by alert/notification polling). */
async function apiGet(url) {
  return _fetchWithAuth(() => fetch(url, { headers: authHeaders() }));
}
