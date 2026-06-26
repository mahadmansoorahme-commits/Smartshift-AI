/* ==========================================================================
   03-utils.js — Generic DOM / functional utilities
   ========================================================================== */
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function setLoading(btn, loading, idleText) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text    = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.textContent = loading ? idleText : (btn.dataset.idleLabel || idleText);
  if (!loading && text) btn.dataset.idleLabel = text.textContent;
}
