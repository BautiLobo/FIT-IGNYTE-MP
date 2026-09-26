// utils/date-format.js
// Short date+weekday label used everywhere a meal-selection day is shown
// (edit-meals/meal-select tabs, order-summary, home's week list, welcome).
// Replaces the old fixed "Monday".."Friday" labels now that a delivery day
// is a real calendar date, not a slot in a Mon-Fri template.

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 'YYYY-MM-DD' -> "19/9 Mon" (en) or "9/19 周一" (zh, month/day, local convention)
function formatShortDate(dateStr, lang) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const month = d.getMonth() + 1;
  if (lang === 'ZH' || lang === 'zh') {
    return `${month}/${day} ${WEEKDAYS_ZH[d.getDay()]}`;
  }
  return `${day}/${month} ${WEEKDAYS_EN[d.getDay()]}`;
}

// Mismo dato que formatShortDate, separado en 2 líneas -- para espacios
// chicos (tabs de día en edit-meals/meal-select) donde "15/9 Tue" en una
// sola línea queda gigante/ilegible dentro de 5 tabs por fila.
function formatDateParts(dateStr, lang) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const month = d.getMonth() + 1;
  if (lang === 'ZH' || lang === 'zh') {
    return { date: `${month}/${day}`, weekday: WEEKDAYS_ZH[d.getDay()] };
  }
  return { date: `${day}/${month}`, weekday: WEEKDAYS_EN[d.getDay()] };
}

module.exports = {
  formatShortDate,
  formatDateParts,
};
