/* ==========================================================================
   16-report.js — FYP Module 10 report generation
   ========================================================================== */

function updateReportChecklist() {
  const map = {
    'rci-upload':   State.pipeline.upload,
    'rci-train':    State.pipeline.train,
    'rci-forecast': State.pipeline.forecast,
    'rci-schedule': State.pipeline.schedule,
    'rci-cost':     State.pipeline.cost,
  };
  let allDone = true;
  Object.entries(map).forEach(([id, done]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('done', !!done);
    el.querySelector('.rci-icon').textContent = done ? '✅' : '⬜';
    if (!done) allDone = false;
  });
  const msg = document.getElementById('report-ready-msg');
  if (msg) msg.style.display = allDone ? 'block' : 'none';
}

function generateReport() {
  const settings   = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const bizName    = settings.businessName || 'SmartShiftAI';
  const currency   = settings.currency || '$';
  const now        = new Date().toLocaleString();
  const notes      = document.getElementById('rpt-notes')?.value || '';
  const incTrain   = document.getElementById('rpt-include-train')?.checked;
  const incForecast= document.getElementById('rpt-include-forecast')?.checked;
  const incSchedule= document.getElementById('rpt-include-schedule')?.checked;
  const incCost    = document.getElementById('rpt-include-cost')?.checked;
  const incWeekly  = document.getElementById('rpt-include-weekly')?.checked;

  const train    = State.lastTrainData;
  const forecast = State.lastForecastData;
  const schedule = State.lastScheduleData;
  const cost     = State.lastCostData;
  const weekly   = State._weeklyScheduleRows || [];

  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${bizName} — SmartShiftAI Report</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1a202c; margin: 0; padding: 32px; }
  .report-container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden; }
  .report-header { background: linear-gradient(135deg, #0d1b2a, #0f2a3a); color: #fff; padding: 36px 40px; }
  .report-header h1 { margin: 0 0 4px; font-size: 1.8rem; color: #00d4aa; }
  .report-header .sub { color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-top: 6px; }
  .report-meta { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; }
  .report-meta span { font-size: 0.8rem; color: rgba(255,255,255,0.5); }
  .report-meta strong { color: rgba(255,255,255,0.85); }
  section { padding: 28px 40px; border-bottom: 1px solid #edf2f7; }
  section:last-child { border-bottom: none; }
  h2 { font-size: 1.1rem; color: #2d3748; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
  .kpi-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .kpi { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; flex: 1; min-width: 140px; }
  .kpi-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .05em; color: #718096; }
  .kpi-value { font-size: 1.4rem; font-weight: 700; color: #00b89a; margin: 4px 0 2px; }
  .kpi-sub { font-size: 0.72rem; color: #a0aec0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { background: #f7fafc; padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; color: #4a5568; }
  td { padding: 9px 12px; border-bottom: 1px solid #edf2f7; color: #2d3748; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 0.7rem; font-weight: 600; }
  .badge-green  { background: #c6f6d5; color: #276749; }
  .badge-blue   { background: #bee3f8; color: #2a69ac; }
  .badge-purple { background: #e9d8fd; color: #6b46c1; }
  .notes-box { background: #fffbeb; border: 1px solid #fbd38d; border-radius: 6px; padding: 14px 18px; font-size: 0.88rem; color: #744210; white-space: pre-wrap; }
  .accuracy-bar-wrap { background: #e2e8f0; border-radius: 4px; height: 8px; margin-top: 8px; overflow: hidden; }
  .accuracy-bar-fill { height: 100%; background: linear-gradient(90deg, #00a884, #00d4aa); border-radius: 4px; }
  @media print {
    body { background: #fff; padding: 0; }
    .report-container { box-shadow: none; border-radius: 0; }
    .no-print { display: none !important; }
  }
</style>
</head><body>
<div class="report-container">
  <div class="report-header">
    <h1>⚡ SmartShiftAI — Workforce Planning Report</h1>
    <div class="sub">AI-powered demand forecasting and shift optimisation</div>
    <div class="report-meta">
      <span><strong>Business:</strong> ${bizName}</span>
      <span><strong>Generated:</strong> ${now}</span>
      ${forecast ? `<span><strong>Forecast Period:</strong> ${forecast.label || ''}</span>` : ''}
    </div>
  </div>`;

  if (incTrain && train) {
    const accColor = train.accuracy >= 80 ? '#276749' : train.accuracy >= 60 ? '#2a69ac' : '#c05621';
    html += `
  <section>
    <h2>🧠 Model Training Summary</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Model Accuracy</div><div class="kpi-value" style="color:${accColor}">${train.accuracy}%</div>
        <div class="accuracy-bar-wrap"><div class="accuracy-bar-fill" style="width:${Math.min(train.accuracy,100)}%"></div></div>
      </div>
      <div class="kpi"><div class="kpi-label">Algorithm</div><div class="kpi-value" style="font-size:1rem;padding-top:6px">${train.model_type}</div><div class="kpi-sub">ML model used</div></div>
      <div class="kpi"><div class="kpi-label">RMSE</div><div class="kpi-value">${train.rmse}</div><div class="kpi-sub">Root Mean Sq. Error</div></div>
      <div class="kpi"><div class="kpi-label">MAE</div><div class="kpi-value">${train.mae}</div><div class="kpi-sub">Mean Absolute Error</div></div>
      <div class="kpi"><div class="kpi-label">Next-Day Prediction</div><div class="kpi-value">${Math.round(train.next_day_pred)}</div><div class="kpi-sub">Predicted customers</div></div>
    </div>
    <p style="font-size:0.83rem;color:#718096">Dataset split: <strong>${train.train_size}</strong> training rows / <strong>${train.test_size}</strong> test rows.</p>
  </section>`;
  }

  if (incForecast && forecast) {
    const predRows = forecast.predictions.map(p =>
      `<tr><td>${p.date}</td><td>${p.day_name}</td><td>${Math.round(p.predicted)}</td>
       <td>${Math.ceil(Math.round(p.predicted)/40)}</td>
       <td>${p.date === forecast.peak_day.date ? '<span class="badge badge-green">Peak</span>' : ''}</td></tr>`
    ).join('');
    html += `
  <section>
    <h2>🔮 Demand Forecast — ${forecast.label || ''}</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Peak Day</div><div class="kpi-value" style="font-size:1.1rem">${forecast.peak_day.day_name}</div><div class="kpi-sub">${forecast.peak_day.date}</div></div>
      <div class="kpi"><div class="kpi-label">Peak Customers</div><div class="kpi-value">${Math.round(forecast.peak_day.predicted)}</div><div class="kpi-sub">Predicted</div></div>
      <div class="kpi"><div class="kpi-label">Avg Customers/Day</div><div class="kpi-value">${Math.round(forecast.predictions.reduce((s,p)=>s+p.predicted,0)/forecast.predictions.length)}</div><div class="kpi-sub">Forecast period</div></div>
    </div>
    <table><thead><tr><th>Date</th><th>Day</th><th>Predicted Customers</th><th>Workers Needed</th><th></th></tr></thead>
    <tbody>${predRows}</tbody></table>
  </section>`;
  }

  if (incSchedule && schedule) {
    const shiftRows = schedule.shifts.map(s =>
      `<tr><td>#${String(s.worker_id).padStart(2,'0')}</td>
       <td><span class="badge badge-${s.classification==='Morning'?'green':s.classification==='Afternoon'?'blue':'purple'}">${s.classification}</span></td>
       <td>${s.start_time}</td><td>${s.end_time}</td><td>${s.total_hours}h</td></tr>`
    ).join('');
    html += `
  <section>
    <h2>🗓️ Shift Schedule (Peak Day)</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Workers Scheduled</div><div class="kpi-value">${schedule.workers_needed}</div><div class="kpi-sub">For ${Math.round(schedule.predicted_customers)} customers</div></div>
      <div class="kpi"><div class="kpi-label">Total Shift Hours</div><div class="kpi-value">${schedule.total_shift_hours}h</div></div>
      <div class="kpi"><div class="kpi-label">Est. Labor Cost</div><div class="kpi-value">${currency}${schedule.total_labor_cost.toLocaleString()}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Shift Length</div><div class="kpi-value">${schedule.avg_shift_hours}h</div></div>
    </div>
    <table><thead><tr><th>Worker</th><th>Classification</th><th>Start</th><th>End</th><th>Hours</th></tr></thead>
    <tbody>${shiftRows}</tbody></table>
  </section>`;
  }

  if (incCost && cost) {
    const isSaving = cost.savings > 0;
    html += `
  <section>
    <h2>💰 Cost Analysis</h2>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Predicted Labor Cost</div><div class="kpi-value">${currency}${cost.predicted_cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="kpi"><div class="kpi-label">Historical Labor Cost</div><div class="kpi-value">${currency}${cost.historical_cost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="kpi"><div class="kpi-label">${isSaving?'Savings':'Extra Cost'}</div>
        <div class="kpi-value" style="color:${isSaving?'#00b89a':'#e53e3e'}">${isSaving?'+':'-'}${currency}${Math.abs(cost.savings).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="kpi-sub">${Math.abs(cost.savings_pct).toFixed(1)}% ${isSaving?'reduction':'increase'}</div>
      </div>
      <div class="kpi"><div class="kpi-label">Hourly Wage</div><div class="kpi-value" style="font-size:1.1rem">${currency}${cost.hourly_wage}/hr</div><div class="kpi-sub">Shift: ${cost.shift_hours}h</div></div>
    </div>
  </section>`;
  }

  if (incWeekly && weekly.length) {
    const wRows = weekly.map(r =>
      `<tr><td>${r.date}</td><td>${r.day}</td><td>${r.customers.toLocaleString()}</td><td>${r.workers}</td><td>${r.morning}</td><td>${r.evening}</td><td>${currency}${parseFloat(r.cost).toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>`
    ).join('');
    html += `
  <section>
    <h2>📅 Full Forecast-Period Schedule</h2>
    <table><thead><tr><th>Date</th><th>Day</th><th>Predicted Customers</th><th>Workers</th><th>Morning</th><th>Evening</th><th>Est. Cost</th></tr></thead>
    <tbody>${wRows}</tbody></table>
  </section>`;
  }

  if (notes.trim()) {
    html += `
  <section>
    <h2>📝 Notes</h2>
    <div class="notes-box">${notes.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </section>`;
  }

  html += `
  <section style="background:#f7fafc;text-align:center;padding:20px 40px">
    <p style="font-size:0.78rem;color:#a0aec0;margin:0">Generated by <strong>SmartShiftAI</strong> &mdash; AI Workforce Planning System &mdash; Final Year Project<br>
    Powered by Flask · scikit-learn · Python 3</p>
    <button onclick="window.print()" class="no-print" style="margin-top:12px;padding:8px 20px;background:#00d4aa;color:#0d1b2a;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:0.88rem">🖨 Print / Save as PDF</button>
  </section>
</div></body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    showToast('Report opened in a new tab — use Print to save as PDF.', 'success');
  } else {
    showToast('Popup blocked — please allow popups for this page.', 'error');
  }
}
