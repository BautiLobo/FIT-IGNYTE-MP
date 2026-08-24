// pages/start-date/index.js
const app = getApp();
const { getMinStartDate, addBusinessDays, isNonWorkingDay, toDateString } = require('../../utils/business-days');
const t = require('../../i18n/index');

Page({
  data: {
    loading: true,
    fromRenewal: false,
    next: 'meal-select',
    selectedDate: '',
    selectedDateFormatted: '',
    expiryDateFormatted: '',
    minDate: '',
    lbl_topbar: '',
    lbl_heading: '',
    lbl_subtitle: '',
    lbl_start_label: '',
    lbl_plan_ends: '',
    lbl_5_days: '',
    lbl_continue: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_topbar: t('start_date_topbar'),
      lbl_heading: t('start_date_heading'),
      lbl_subtitle: t('start_date_subtitle'),
      lbl_start_label: t('start_date_label'),
      lbl_plan_ends: t('start_date_plan_ends'),
      lbl_5_days: t('start_date_5_days'),
      lbl_continue: t('start_date_continue'),
    });
    const fromRenewal = options.from === 'renewal';
    const next = options.next === 'edit-meals' ? 'edit-meals' : 'meal-select';
    this.setData({ fromRenewal, next });

    // Renovación anticipada (ver RENEWAL_PLAN.md): si el cliente renueva
    // antes de que venza su plan actual, el mínimo no puede ser antes del
    // día siguiente a ese vencimiento -- si no, se pisa o se solapa con el
    // ciclo en curso. getMinStartDate() ya resuelve esto (usa el mayor
    // entre "próximo día hábil desde hoy" y "próximo día hábil después del
    // vencimiento actual") -- misma función que payment.js reusa para
    // detectar una fecha vencida al momento de pagar.
    // El wxml mantiene el picker oculto (wx:if="{{loading}}") hasta que esto
    // termine -- si no, hay una ventana real (mientras se espera el fetch
    // del cliente) donde `minDate` todavía es '' y el picker no bloquea
    // nada, dejando elegir cualquier fecha, incluido el mismo día del
    // vencimiento actual.
    let currentExpiryDate = null;
    if (fromRenewal) {
      try {
        const clientId = wx.getStorageSync('clientId');
        if (clientId) {
          const data = await app.getClient({ clientId });
          const client = data && data[0];
          if (client && client.expiry_date) currentExpiryDate = client.expiry_date;
        }
      } catch (err) {
        console.error('start-date onLoad client fetch error:', err);
      }
    }

    const minStr = getMinStartDate({ currentExpiryDate });
    const min = new Date(minStr + 'T00:00:00');
    const formatted = this.formatDate(min);
    const expiry = addBusinessDays(min, 4); // 5 days total including start
    const expiryFormatted = this.formatDate(expiry);

    this.setData({
      loading: false,
      minDate: minStr,
      selectedDate: minStr,
      selectedDateFormatted: formatted,
      expiryDateFormatted: expiryFormatted,
    });
  },

  onDateChange(e) {
    const dateStr = e.detail.value; // YYYY-MM-DD
    const date = new Date(dateStr + 'T00:00:00');

    if (isNonWorkingDay(date)) {
      wx.showToast({ title: t('start_date_no_delivery'), icon: 'none', duration: 2500 });
      return; // keep the previously selected date
    }

    const expiry = addBusinessDays(date, 4);

    this.setData({
      selectedDate: toDateString(date),
      selectedDateFormatted: this.formatDate(date),
      expiryDateFormatted: this.formatDate(expiry),
    });
  },

  formatDate(date) {
    try {
      const lang = wx.getAppBaseInfo().language || 'en';
      if (lang.startsWith('zh')) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return `${date.getMonth() + 1}月${date.getDate()}日 ${days[date.getDay()]}`;
      }
    } catch (e) {}
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
  },

  goNext() {
    // Save start and expiry dates to storage
    wx.setStorageSync('startDate', this.data.selectedDate);
    // Calculate expiry
    const startDate = new Date(this.data.selectedDate + 'T00:00:00');
    const expiry = addBusinessDays(startDate, 4);
    wx.setStorageSync('expiryDate', toDateString(expiry));

    const { fromRenewal, next } = this.data;
    const target = next === 'edit-meals' ? '/pages/edit-meals/index' : '/pages/meal-select/index';
    const url = fromRenewal ? `${target}?from=renewal` : target;
    wx.navigateTo({ url });
  },

  goBack() {
    wx.navigateBack();
  },
});
