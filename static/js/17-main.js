/* ==========================================================================
   17-main.js — Bootstrap, cross-module wiring, pipeline enable chain
   ========================================================================== */

/* ---- Extend refreshDashboard to keep report checklist in sync ---- */
(function () {
  const _orig = refreshDashboard;
  refreshDashboard = function () {
    _orig();
    updateReportChecklist();
  };
}());

/* ---- After training: enable forecast button ---- */
(function () {
  const _orig = handleTrain;
  handleTrain = async function () {
    await _orig();
    if (State.pipeline.train) enableForecastButton();
  };
}());

/* ---- After forecast: enable schedule button ---- */
(function () {
  const _orig = handleForecast;
  handleForecast = async function () {
    await _orig();
    if (State.pipeline.forecast) enableScheduleButton();
  };
}());

/* ---- After schedule: enable cost button ---- */
(function () {
  const _orig = handleCalculate;
  handleCalculate = async function () {
    await _orig();
    if (State.pipeline.schedule) enableCostButton();
  };
}());

/* ---- Cross-module callback: runs after every successful upload ---- */
function onUploadSuccess() {
  enableTrainButton();
  enableHistoryButton();
  loadDashboardTrendChart();
}

/* ---- Start the actual app (only after the user is authenticated) ---- */
async function startApp() {
  if (window.__ssAppStarted) return;
  window.__ssAppStarted = true;

  hideAuthScreen();

  const appEl = document.getElementById('app');
  appEl.classList.add('visible');
  appEl.removeAttribute('aria-hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => appEl.classList.add('revealed'));
  });

  // Show the logged-in user's email in the sidebar
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  const emailEl = document.getElementById('user-email');
  if (emailEl && user) emailEl.textContent = user.email || 'Signed in';

  await fetchCsrfToken();

  initNav();
  initResetButton();
  initClearAlertsButton();
  initAlertFilterTabs();
  initUpload();
  initTrain();
  initForecast();
  initSchedule();
  initCosts();
  initHistory();
  refreshDashboard();
  startNotificationPolling();
  await loadSettings();

  if (typeof wireAccountUI  === 'function') wireAccountUI();
  if (typeof populateAccount === 'function') populateAccount();

  // Bring back the user's last dataset if the server lost it (e.g. after restart).
  if (typeof restoreLastDataset === 'function') restoreLastDataset();

  State.sessionReady = true;
}

/* ---- Bootstrap: boot animation, then auth gate ---- */
async function bootstrap() {
  const isRecovery = window.location.hash.includes('type=recovery');

  await runBootAnimation();

  const bootEl = document.getElementById('boot-screen');
  if (bootEl) bootEl.remove();

  // Initialise Supabase + wire the login/signup/forgot screens
  initSupabase();
  wireAuthUI();

  // Password-recovery deep link → show "set new password"
  if (isRecovery) { showAuthScreen('reset'); return; }

  // Is this page load the tail end of an OAuth redirect still being processed?
  const hasAuthCallback = /access_token=|[?&]code=/.test(window.location.hash + window.location.search);

  // Already logged in? Start the app. Otherwise show the login screen.
  const session = await refreshSession();
  if (session) {
    await startApp();
  } else if (hasAuthCallback) {
    // OAuth round-trip still resolving — show a spinner, not the login form.
    // onAuthStateChange(SIGNED_IN) will start the app; fall back to login if it stalls.
    showAuthScreen('loading');
    setTimeout(() => { if (!window.__ssAppStarted) showAuthScreen('login'); }, 5000);
  } else {
    showAuthScreen('login');
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
