/* ==========================================================================
   04-export.js — CSV download utilities
   ========================================================================== */
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvLines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportForecastCSV() {
  if (!State.lastForecastData) return showToast('No forecast data to export.', 'error');
  const d = State.lastForecastData;
  const headers = ['Date', 'Day', 'Predicted Customers', 'Workers Needed', 'Is Peak'];
  const rows = d.predictions.map(p => [
    p.date, p.day_name, Math.round(p.predicted),
    Math.ceil(Math.round(p.predicted) / 40),
    p.date === d.peak_day.date ? 'Yes' : 'No',
  ]);
  downloadCSV(`SmartShiftAI_Forecast_${d.label.replace(/\s+/g, '_')}.csv`, headers, rows);
  showToast('Forecast exported as CSV.', 'success');
}

function exportScheduleCSV() {
  if (!State.lastScheduleData) return showToast('No schedule data to export.', 'error');
  const d = State.lastScheduleData;
  const headers = ['Worker ID', 'Classification', 'Start Time', 'End Time', 'Shift Hours', 'Optimization'];
  const rows = d.shifts.map(s => [
    `#${String(s.worker_id).padStart(2, '0')}`,
    s.classification, s.start_time, s.end_time, s.total_hours, s.badge?.label || '',
  ]);
  const filename = `SmartShiftAI_Schedule_${new Date().toISOString().slice(0,10)}.csv`;
  downloadCSV(filename, headers, rows);
  showToast('Schedule exported as CSV.', 'success');
}

function exportCostCSV() {
  if (!State.lastCostData) return showToast('No cost data to export.', 'error');
  const d = State.lastCostData;
  const headers = ['Metric', 'Value'];
  const rows = [
    ['Predicted Labor Cost', `$${d.predicted_cost.toFixed(2)}`],
    ['Historical Labor Cost', `$${d.historical_cost.toFixed(2)}`],
    ['Savings', `$${d.savings.toFixed(2)}`],
    ['Savings %', `${d.savings_pct.toFixed(1)}%`],
    ['Hourly Wage', `$${d.hourly_wage}`],
    ['Shift Hours', d.shift_hours],
    ['Predicted Workers', d.predicted_workers],
    ['Historical Workers', d.historical_workers],
  ];
  downloadCSV(`SmartShiftAI_CostAnalysis_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
  showToast('Cost analysis exported as CSV.', 'success');
}

function exportWeeklyScheduleCSV() {
  if (!State._weeklyScheduleRows || !State._weeklyScheduleRows.length)
    return showToast('Generate a schedule first.', 'error');
  const headers = ['Date', 'Day', 'Predicted Customers', 'Workers Needed', 'Morning Shifts', 'Evening Shifts', 'Est. Cost ($)'];
  const rows = State._weeklyScheduleRows.map(r => [r.date, r.day, r.customers, r.workers, r.morning, r.evening, r.cost]);
  downloadCSV(`SmartShiftAI_WeeklySchedule_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
  showToast('Weekly schedule exported.', 'success');
}
