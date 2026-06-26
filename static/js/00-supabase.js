/* ==========================================================================
   00-supabase.js — Supabase client, authentication, and the login/signup gate
   ==========================================================================
   Auth runs entirely on the client via the Supabase JS library. The resulting
   access token (JWT) is cached here and attached to every backend API call
   (see 02-api.js). The Flask backend verifies that token.
   ========================================================================== */

let sb = null;                 // the Supabase client (set in initSupabase)
let _accessToken = null;       // cached JWT for backend calls
let _currentUser = null;       // cached user object

/* ---- Initialise the client from /app-config.js (window.SS_CONFIG) -------- */
function initSupabase() {
  const cfg = window.SS_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error('Supabase config missing — check /app-config.js and your .env');
    return null;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Supabase JS library not loaded.');
    return null;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // Keep the cached token/user in sync with auth state changes.
  sb.auth.onAuthStateChange((event, session) => {
    _accessToken = session?.access_token || null;
    _currentUser = session?.user || null;

    if (event === 'PASSWORD_RECOVERY') {
      showAuthScreen('reset');
      return;
    }
    if (event === 'SIGNED_IN'  && !window.__ssAppStarted) startApp();
    if (event === 'SIGNED_OUT') window.location.reload();
  });

  return sb;
}

/* ---- Token / session accessors (used by 02-api.js) ----------------------- */
function getAccessToken() { return _accessToken; }
function getCurrentUser() { return _currentUser; }

async function refreshSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  _accessToken = data?.session?.access_token || null;
  _currentUser = data?.session?.user || null;
  return data?.session || null;
}

/* Force a token refresh (called after a backend 401). Returns true on success. */
async function forceRefresh() {
  if (!sb) return false;
  try {
    const { data, error } = await sb.auth.refreshSession();
    if (error || !data?.session) return false;
    _accessToken = data.session.access_token;
    _currentUser = data.session.user;
    return true;
  } catch (e) {
    return false;
  }
}

/* Called when the backend keeps rejecting us — session is truly dead. */
let _authExpiredShown = false;
function onAuthExpired() {
  if (_authExpiredShown) return;
  _authExpiredShown = true;
  try { if (typeof showToast === 'function') showToast('Your session expired — please log in again.', 'warning'); } catch (_) {}
  setTimeout(() => { signOutUser(); }, 1200);   // SIGNED_OUT → reload to login screen
}

/* Password policy: min 8 chars, at least one letter and one number. */
function validatePassword(p) {
  if (!p || p.length < 8)  return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(p))    return 'Password must contain at least one number.';
  return null;
}

/* ---- Auth actions -------------------------------------------------------- */
async function signInEmail(email, password) {
  return sb.auth.signInWithPassword({ email, password });
}

async function signUpEmail(email, password) {
  return sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
}

async function signInGoogle() {
  // Supabase handles "create account if new, else log in" automatically.
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

async function sendPasswordReset(email) {
  return sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
}

async function setNewPassword(password) {
  return sb.auth.updateUser({ password });
}

async function signOutUser() {
  // Best-effort: clear the server-side in-memory session + temp files first.
  try { if (typeof apiPost === 'function' && getAccessToken()) await apiPost('/auth/logout'); } catch (_) {}
  if (sb) await sb.auth.signOut();
}

/* ==========================================================================
   Auth screen UI
   ========================================================================== */
function showAuthScreen(view = 'login') {
  const screen = document.getElementById('auth-screen');
  const app    = document.getElementById('app');
  if (app)    { app.classList.remove('visible', 'revealed'); app.setAttribute('aria-hidden', 'true'); }
  if (screen) { screen.style.display = 'flex'; }
  switchAuthView(view);
}

function hideAuthScreen() {
  const screen = document.getElementById('auth-screen');
  if (screen) screen.style.display = 'none';
}

function switchAuthView(view) {
  ['login', 'signup', 'forgot', 'reset', 'loading'].forEach((v) => {
    const el = document.getElementById(`auth-view-${v}`);
    if (el) el.style.display = (v === view) ? 'block' : 'none';
  });
  // clear any stale messages
  document.querySelectorAll('.auth-msg').forEach((m) => { m.textContent = ''; m.className = 'auth-msg'; });
}

function _authMsg(id, text, kind = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `auth-msg ${kind}`;
}

function _btnBusy(btn, busy, idleText) {
  if (!btn) return;
  btn.disabled = busy;
  btn.dataset.idle = btn.dataset.idle || btn.textContent;
  btn.textContent = busy ? 'Please wait…' : (idleText || btn.dataset.idle);
}

/* ---- Wire up all auth buttons / links (called once at boot) -------------- */
function wireAuthUI() {
  // view switching links
  const links = {
    'login-to-signup':  'signup',
    'login-to-forgot':  'forgot',
    'signup-to-login':  'login',
    'forgot-to-login':  'login',
  };
  Object.entries(links).forEach(([id, view]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => { e.preventDefault(); switchAuthView(view); });
  });

  // ---- Login ----
  const loginBtn = document.getElementById('login-submit');
  if (loginBtn) loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    if (!email || !pass) return _authMsg('login-error', 'Enter your email and password.');
    _btnBusy(loginBtn, true);
    const { error } = await signInEmail(email, pass);
    _btnBusy(loginBtn, false, 'Log In');
    if (error) return _authMsg('login-error', error.message);
    // onAuthStateChange(SIGNED_IN) will start the app
  });

  // ---- Signup ----
  const signupBtn = document.getElementById('signup-submit');
  if (signupBtn) signupBtn.addEventListener('click', async () => {
    const email = document.getElementById('signup-email').value.trim();
    const pass  = document.getElementById('signup-password').value;
    const pass2 = document.getElementById('signup-password2').value;
    if (!email || !pass)   return _authMsg('signup-error', 'Enter an email and password.');
    const sErr = validatePassword(pass);
    if (sErr)              return _authMsg('signup-error', sErr);
    if (pass !== pass2)    return _authMsg('signup-error', 'Passwords do not match.');
    _btnBusy(signupBtn, true);
    const { data, error } = await signUpEmail(email, pass);
    _btnBusy(signupBtn, false, 'Create Account');
    if (error) return _authMsg('signup-error', error.message);
    if (data.session) {
      // email confirmation disabled → logged in immediately
      _authMsg('signup-error', 'Account created!', 'success');
    } else {
      _authMsg('signup-error', 'Account created — check your email to confirm, then log in.', 'success');
    }
  });

  // ---- Google (same on login & signup) ----
  ['login-google', 'signup-google'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', async () => {
      _btnBusy(el, true);
      const { error } = await signInGoogle();
      if (error) { _btnBusy(el, false); _authMsg(id.startsWith('login') ? 'login-error' : 'signup-error', error.message); }
      // otherwise the browser redirects to Google
    });
  });

  // ---- Forgot password ----
  const forgotBtn = document.getElementById('forgot-submit');
  if (forgotBtn) forgotBtn.addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return _authMsg('forgot-msg', 'Enter your email address.');
    _btnBusy(forgotBtn, true);
    const { error } = await sendPasswordReset(email);
    _btnBusy(forgotBtn, false, 'Send Reset Link');
    if (error) return _authMsg('forgot-msg', error.message);
    _authMsg('forgot-msg', 'Reset link sent! Check your email.', 'success');
  });

  // ---- Set new password (after recovery email) ----
  const resetBtn = document.getElementById('reset-submit');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    const pass  = document.getElementById('reset-password').value;
    const pass2 = document.getElementById('reset-password2').value;
    const rErr = validatePassword(pass);
    if (rErr)           return _authMsg('reset-msg', rErr);
    if (pass !== pass2) return _authMsg('reset-msg', 'Passwords do not match.');
    _btnBusy(resetBtn, true);
    const { error } = await setNewPassword(pass);
    _btnBusy(resetBtn, false, 'Update Password');
    if (error) return _authMsg('reset-msg', error.message);
    _authMsg('reset-msg', 'Password updated! Loading your dashboard…', 'success');
    setTimeout(() => { hideAuthScreen(); if (!window.__ssAppStarted) startApp(); }, 900);
  });

  // ---- Enter-to-submit on each view ----
  const submitOnEnter = (inputId, btnId) => {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById(btnId)?.click(); });
  };
  submitOnEnter('login-password',  'login-submit');
  submitOnEnter('signup-password2','signup-submit');
  submitOnEnter('forgot-email',    'forgot-submit');
  submitOnEnter('reset-password2', 'reset-submit');

  // ---- Resend confirmation email ----
  const resendLink = document.getElementById('login-resend');
  if (resendLink) resendLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    if (!email) return _authMsg('login-error', 'Enter your email above first, then click resend.');
    try {
      const { error } = await sb.auth.resend({ type: 'signup', email });
      if (error) return _authMsg('login-error', error.message);
      _authMsg('login-error', 'Confirmation email resent — check your inbox.', 'success');
    } catch (_) {
      _authMsg('login-error', 'Could not resend — try again shortly.');
    }
  });

  // ---- Logout button ----
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', signOutUser);
}
