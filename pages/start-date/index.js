// pages/start-date/index.js
// Calendario propio de días de entrega: el cliente elige 5 fechas reales
// dentro de una ventana de 14 días hábiles (fines de semana y feriados
// bloqueados), en vez de "5 días corridos desde una fecha de arranque".
const app = getApp();
const {
  getMinStartDate,
  toDateString,
  getValidDeliveryWindow,
  deriveRenewalDates,
} = require('../../utils/business-days');
const t = require('../../i18n/index');

const DELIVERY_DAYS_COUNT = 5;
const WINDOW_BUSINESS_DAYS = 14;

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const WEEKDAY_HEADERS = _isZh
  ? ['一', '二', '三', '四', '五', '六', '日']
  : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(date) {
  if (_isZh) return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  return `${MONTH_NAMES_EN[date.getMonth()]} ${date.getFullYear()}`;
}

Page({
  data: {
    loading: true,
    fromRenewal: false,
    minDate: '',
    monthGroups: [],
    weekdayHeaders: WEEKDAY_HEADERS,
    selectedDates: [],
    selectedCount: 0,
    canContinue: false,
    lbl_topbar: '',
    lbl_heading: '',
    lbl_subtitle: '',
    lbl_counter: '',
    lbl_legend_selected: '',
    lbl_legend_available: '',
    lbl_legend_unavailable: '',
    lbl_continue: '',
  },

  // Fuera de `data`: no necesita re-render, solo lo usa toggleDate().
  windowDates: [],

  async onLoad(options) {
    this.setData({
      lbl_topbar: t('start_date_topbar'),
      lbl_heading: t('start_date_heading'),
      lbl_subtitle: t('start_date_subtitle'),
      lbl_legend_selected: t('start_date_legend_selected'),
      lbl_legend_available: t('start_date_legend_available'),
      lbl_legend_unavailable: t('start_date_legend_unavailable'),
      lbl_continue: t('start_date_continue'),
    });
    const fromRenewal = options.from === 'renewal';
    this.setData({ fromRenewal });

    // Renovación anticipada (ver RENEWAL_PLAN.md): si el cliente renueva
    // antes de que venza su plan actual, el mínimo no puede ser antes del
    // día siguiente a ese vencimiento -- si no, se pisa o se solapa con el
    // ciclo en curso. getMinStartDate() ya resuelve esto.
    let currentExpiryDate = null;
    // El default es repetir el mismo patrón relativo de días que el ciclo
    // actual, no resetear a 5 seguidos -- para eso hace falta leer qué
    // fechas tiene elegidas hoy. Esto aplica a toda renovación: son las
    // FECHAS de entrega las que se repiten, no las comidas (esas se eligen
    // siempre de cero, ver startRenewal() en renewal/index.js).
    let previousDates = null;
    if (fromRenewal) {
      try {
        const clientId = wx.getStorageSync('clientId');
        if (clientId) {
          const data = await app.getClient({ clientId });
          const client = data && data[0];
          if (client && client.expiry_date) currentExpiryDate = client.expiry_date;

          const rows = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=delivery_date.asc`);
          const dates = Array.from(new Set((rows || []).map((r) => r.delivery_date).filter(Boolean))).sort();
          if (dates.length > 0) previousDates = dates;
        }
      } catch (err) {
        console.error('start-date onLoad client fetch error:', err);
      }
    }

    const minStr = getMinStartDate({ currentExpiryDate });
    const windowDates = getValidDeliveryWindow(minStr, WINDOW_BUSINESS_DAYS);
    this.windowDates = windowDates;

    let defaultSelected = windowDates.slice(0, DELIVERY_DAYS_COUNT);
    if (previousDates && previousDates.length === DELIVERY_DAYS_COUNT) {
      defaultSelected = deriveRenewalDates(previousDates[0], previousDates, minStr);
    }

    this.setData({
      loading: false,
      minDate: minStr,
      selectedDates: defaultSelected,
      selectedCount: defaultSelected.length,
      canContinue: defaultSelected.length === DELIVERY_DAYS_COUNT,
      lbl_counter: t('start_date_counter', defaultSelected.length),
      monthGroups: this.buildMonthGroups(minStr, windowDates, defaultSelected),
    });
  },

  // Arma semanas completas (lunes a domingo) desde la semana de `minDate`
  // hasta la semana de la última fecha válida de la ventana, agrupadas por
  // el mes en el que cae el lunes de cada semana (una semana que cruza fin
  // de mes queda bajo el header del mes en que arrancó, igual que el
  // calendario de referencia que mandó el usuario).
  buildMonthGroups(minDateStr, windowDates, selectedDates) {
    const windowSet = new Set(windowDates);
    const selectedSet = new Set(selectedDates);
    const lastD = new Date(windowDates[windowDates.length - 1] + 'T00:00:00');

    const cursor = new Date(minDateStr + 'T00:00:00');
    const dow = cursor.getDay();
    cursor.setDate(cursor.getDate() + (dow === 0 ? -6 : 1 - dow)); // lunes de esa semana

    const groups = [];
    let currentKey = null;
    let currentGroup = null;

    while (true) {
      const weekMonday = new Date(cursor);
      const cells = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        d.setDate(cursor.getDate() + i);
        const dateStr = toDateString(d);
        const available = windowSet.has(dateStr);
        const selected = selectedSet.has(dateStr);
        cells.push({
          dateStr,
          dayNum: d.getDate(),
          state: selected ? 'selected' : (available ? 'available' : 'unavailable'),
        });
      }

      const key = `${weekMonday.getFullYear()}-${weekMonday.getMonth()}`;
      if (key !== currentKey) {
        currentKey = key;
        currentGroup = { key, label: monthLabel(weekMonday), weeks: [] };
        groups.push(currentGroup);
      }
      currentGroup.weeks.push({ key: toDateString(weekMonday), cells });

      if (weekMonday >= lastD) break;
      cursor.setDate(cursor.getDate() + 7);
    }

    return groups;
  },

  toggleDate(e) {
    const { date: dateStr, state } = e.currentTarget.dataset;
    if (state === 'unavailable') {
      // "unavailable" agrupa 2 motivos distintos: cae fuera de la ventana
      // seleccionable (antes del mínimo, o más allá de los 14 días hábiles)
      // vs. cae adentro de la ventana pero es fin de semana/feriado. Antes
      // se mostraba siempre el mensaje de fin de semana/feriado, que era
      // engañoso para el primer caso.
      const lastWindowDate = this.windowDates[this.windowDates.length - 1];
      const outOfRange = dateStr < this.data.minDate || dateStr > lastWindowDate;
      wx.showToast({
        title: t(outOfRange ? 'start_date_out_of_range' : 'start_date_no_delivery'),
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    let { selectedDates } = this.data;
    const idx = selectedDates.indexOf(dateStr);
    if (idx >= 0) {
      selectedDates = selectedDates.slice();
      selectedDates.splice(idx, 1);
    } else {
      if (selectedDates.length >= DELIVERY_DAYS_COUNT) {
        wx.showToast({ title: t('start_date_max_reached', DELIVERY_DAYS_COUNT), icon: 'none' });
        return;
      }
      selectedDates = selectedDates.concat([dateStr]).sort();
    }

    this.setData({
      selectedDates,
      selectedCount: selectedDates.length,
      canContinue: selectedDates.length === DELIVERY_DAYS_COUNT,
      lbl_counter: t('start_date_counter', selectedDates.length),
      monthGroups: this.buildMonthGroups(this.data.minDate, this.windowDates, selectedDates),
    });
  },

  goNext() {
    const { selectedDates, fromRenewal } = this.data;
    if (selectedDates.length !== DELIVERY_DAYS_COUNT) {
      wx.showToast({ title: t('start_date_counter', selectedDates.length), icon: 'none' });
      return;
    }

    const sorted = selectedDates.slice().sort();
    wx.setStorageSync('selectedDates', sorted);
    // Compat: todo consumidor existente (repago, get-client, create-payment,
    // cron de notificaciones) sigue esperando estas dos claves -- ahora
    // significan "primera fecha elegida" / "última fecha elegida", ya no
    // "5 días corridos desde acá".
    wx.setStorageSync('startDate', sorted[0]);
    wx.setStorageSync('expiryDate', sorted[sorted.length - 1]);

    // Destino único: elegir las comidas del ciclo nuevo desde cero.
    const url = fromRenewal ? '/pages/meal-select/index?from=renewal' : '/pages/meal-select/index';
    wx.navigateTo({ url });
  },

  goBack() {
    wx.navigateBack();
  },
});
