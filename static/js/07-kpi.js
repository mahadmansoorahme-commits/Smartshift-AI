/* ==========================================================================
   07-kpi.js — KPI cards, dashboard refresh, pipeline step indicators
   ========================================================================== */
const _wsMap = {
  'kv-rows':     'ws-rows',
  'kv-model':    'ws-model',
  'kv-forecast': 'ws-forecast',
  'kv-shifts':   'ws-shifts',
};

function updateKPI(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? '—';
  const card = el.closest('.kpi-card');
  if (card) {
    card.classList.remove('animate');
    void card.offsetWidth;
    card.classList.add('animate');
  }
  const wsEl = document.getElementById(_wsMap[id]);
  if (wsEl) wsEl.textContent = value ?? '—';
}

function refreshDashboard() {
  if (State.dataRows     !== null) updateKPI('kv-rows',     State.dataRows);
  if (State.modelType    !== null) updateKPI('kv-model',    State.modelType);
  if (State.forecastDays !== null) updateKPI('kv-forecast', State.forecastDays);
  if (State.shiftsPlanned !== null) updateKPI('kv-shifts',  State.shiftsPlanned);
  updatePipelineSteps();
}

const _sidebarStepMap = {
  upload:   'upload',
  train:    'train',
  forecast: 'forecast',
  schedule: 'schedule',
  costs:    'cost',
};

function updatePipelineSteps() {
  const steps = ['upload', 'train', 'forecast', 'schedule', 'cost'];
  steps.forEach((s, i) => {
    const node = document.getElementById(`step-${s}`);
    const lbl  = document.getElementById(`step-lbl-${s}`);
    const line = document.getElementById(`line-${i + 1}`);
    if (!node) return;
    const done = State.pipeline[s];
    node.className = `step-node${done ? ' done' : ''}`;
    if (lbl) lbl.className = `step-label${done ? ' done' : ''}`;
    if (line) line.className = `step-line${done ? ' done' : ''}`;
  });

  Object.entries(_sidebarStepMap).forEach(([page, pipelineKey]) => {
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (!navItem) return;
    const done = State.pipeline[pipelineKey];
    navItem.classList.toggle('step-done', !!done);
    let check = navItem.querySelector('.step-check');
    if (done) {
      if (!check) {
        check = document.createElement('span');
        check.className = 'step-check';
        check.textContent = '✓';
        navItem.appendChild(check);
      }
    } else if (check) {
      check.remove();
    }
  });
}
