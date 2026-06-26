/* ==========================================================================
   06-nav.js — SPA navigation
   ========================================================================== */
function initNav() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click',   () => navigateTo(item.dataset.page));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') navigateTo(item.dataset.page); });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  if (page === 'alerts') {
    State.unreadAlerts = 0;
    updateAlertBadge();
  }

  if (page === 'history' && State.pipeline.upload) {
    const btn = document.getElementById('history-load-btn');
    if (btn && !btn.disabled) {
      const trendCard = document.getElementById('history-trend-card');
      if (trendCard && trendCard.style.display === 'none') {
        setTimeout(() => handleLoadHistory(), 150);
      }
    }
  }

  if (page === 'dashboard' && State.pipeline.upload) {
    const card = document.getElementById('dashboard-trend-card');
    if (card && card.style.display === 'none') loadDashboardTrendChart();
  }
}
