// pages/start-date/holidays.js
// Official PRC public holiday calendar (State Council).
// Update this list every November when the State Council publishes next year's schedule.
// Source (2026): https://www.china-briefing.com/news/china-2026-public-holiday-schedule/

// Days off — no deliveries.
const PUBLIC_HOLIDAYS_2026 = [
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

// Weekends turned into working days to compensate for the holidays above —
// deliveries DO happen on these dates even though they fall on a Sat/Sun.
const MAKEUP_WORKDAYS_2026 = [
  '2026-01-04', // compensates New Year's Day
  '2026-02-14', '2026-02-28', // compensates Spring Festival
  '2026-05-09', // compensates Labor Day
  '2026-09-20', '2026-10-10', // compensates National Day
];

module.exports = {
  PUBLIC_HOLIDAYS: PUBLIC_HOLIDAYS_2026,
  MAKEUP_WORKDAYS: MAKEUP_WORKDAYS_2026,
};
