// utils/holidays.js
// Official PRC public holiday calendar (State Council).
//
// La fuente de verdad es la fila `public_holidays` de la tabla `settings`.
// La leen create-payment y wx-notify-cron del lado del servidor, y el
// mini-program la cachea al arrancar (ver fetchPublicHolidays en app.js).
// Al actualizar el calendario cada noviembre, tocar SOLO esa fila.
//
// La lista de abajo es un fallback para cuando la app todavía no pudo leer
// `settings` (primer arranque, sin señal): sin ella el calendario de
// pages/start-date ofrecería feriados como días de entrega. Que quede
// desactualizada no es grave, porque create-payment revalida la fecha
// contra `settings` antes de cobrar.
// Source (2026): https://www.china-briefing.com/news/china-2026-public-holiday-schedule/

// Days off — no deliveries.
const FALLBACK_HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02', '2026-01-03', // New Year's Day
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // Spring Festival
  '2026-04-04', '2026-04-05', '2026-04-06', // Qingming Festival
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // Labor Day
  '2026-06-19', '2026-06-20', '2026-06-21', // Dragon Boat Festival
  '2026-09-25', '2026-09-26', '2026-09-27', // Mid-Autumn Festival
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07', // National Day Golden Week
];

const STORAGE_KEY = 'publicHolidays';

// Lo último que se leyó de `settings`, o el fallback. Es sincrónico a
// propósito: lo consume isNonWorkingDay(), que corre dentro de loops de
// cálculo de fechas y no puede ser async.
function getPublicHolidays() {
  try {
    const cached = wx.getStorageSync(STORAGE_KEY);
    if (Array.isArray(cached) && cached.length > 0) return cached;
  } catch (e) {}
  return FALLBACK_HOLIDAYS_2026;
}

function cachePublicHolidays(list) {
  if (!Array.isArray(list)) return;
  const limpia = list.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (limpia.length === 0) return;
  try {
    wx.setStorageSync(STORAGE_KEY, limpia);
  } catch (e) {}
}

// NOTE: The government designates certain Sat/Sundays as compensatory
// working days ("bandiao") to make up for the holidays above (e.g. the
// Sat 2026-01-04 makes up for New Year's Day). We deliberately ignore
// that — this business never delivers on a weekend, compensatory or not.
// See isNonWorkingDay in ./business-days.js.

module.exports = {
  getPublicHolidays,
  cachePublicHolidays,
  FALLBACK_HOLIDAYS: FALLBACK_HOLIDAYS_2026,
};
