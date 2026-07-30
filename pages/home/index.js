// pages/home/index.js
const app = getApp();
const t = require('../../i18n/index');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const DAYS = [
  { key: 'mon', short: _isZh ? '周一' : 'MON', full: 'Monday', idx: 1 },
  { key: 'tue', short: _isZh ? '周二' : 'TUE', full: 'Tuesday', idx: 2 },
  { key: 'wed', short: _isZh ? '周三' : 'WED', full: 'Wednesday', idx: 3 },
  { key: 'thu', short: _isZh ? '周四' : 'THU', full: 'Thursday', idx: 4 },
  { key: 'fri', short: _isZh ? '周五' : 'FRI', full: 'Friday', idx: 5 },
];

Page({
  data: {
    loading: true,
    client: null,
    firstName: '',
    weekMeals: [],
    todayDelivery: null,
    showRenewal: false,
    daysLeft: 0,
    notifications: [],
    lbl_hi: '',
    lbl_active: '',
    lbl_upcoming: '',
    lbl_plan_starts_soon: '',
    lbl_first_delivery: '',
    lbl_this_weeks_meals: '',
    lbl_edit: '',
    lbl_contact: '',
  },

  async onLoad() {
    this.setData({
      lbl_active: t('home_active'),
      lbl_upcoming: t('home_upcoming'),
      lbl_plan_starts_soon: t('home_plan_starts_soon'),
      lbl_this_weeks_meals: t('home_this_weeks_meals'),
      lbl_edit: t('home_edit'),
      lbl_contact: t('home_contact'),
    });
    await this.loadClientData();
    await this.loadNotifications();
    const clientId = wx.getStorageSync('clientId');
    if (clientId) {
      app.captureOpenid(clientId);
    }
  },

  onShow() {
    this.loadClientData();
    this.loadNotifications();
  },

  async loadNotifications() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.supabase('GET', 'notifications', null, `client_id=eq.${clientId}&is_read=eq.false&order=created_at.desc`);
      this.setData({ notifications: data || [] });
    } catch (err) {
      console.error('Load notifications error:', err);
    }
  },

  async dismissNotification(e) {
    const id = e.currentTarget.dataset.id;
    const notifications = this.data.notifications.filter(n => n.id !== id);
    this.setData({ notifications });

    try {
      await app.supabase('PATCH', 'notifications', { is_read: true }, `id=eq.${id}`);
    } catch (err) {
      console.error('Dismiss notification error:', err);
    }
  },

  async loadClientData() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) {
      wx.reLaunch({ url: '/pages/discovery/index' });
      return;
    }

    try {
      const data = await app.getClient({ clientId });
      if (!data || data.length === 0) {
        wx.reLaunch({ url: '/pages/discovery/index' });
        return;
      }

      const client = data[0];

      if (client.plan_id) {
        const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (planData && planData.length > 0) {
          client.plan_name = planData[0].name;
        }
      }

      const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc,slot.asc`);
      const selections = selectionsData || [];

      const firstName = client.name ? client.name.split(' ')[0] : 'there';

      // Determinar qué día le corresponde "hoy" dentro del plan, basado en start_date
      const planDayKey = this.getPlanDayKey(client.start_date, client.expiry_date);

      const weekMeals = await this.buildWeekMeals(selections, planDayKey);
      const todayDelivery = this.getTodayDelivery(weekMeals);
      const daysLeft = this.getDaysLeft(client.expiry_date);

      const realStatus = app.getRealStatus(client.start_date, client.expiry_date);
      const isUpcoming = realStatus === 'Upcoming';

      let startDateFormatted = '';
      if (isUpcoming && client.start_date) {
        const d = new Date(client.start_date + 'T00:00:00');
        const dow = d.getDay();
        if (dow === 6) d.setDate(d.getDate() + 2);
        if (dow === 0) d.setDate(d.getDate() + 1);
        startDateFormatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      }

      const realToday = new Date().getDay();
      const showRenewal = !isUpcoming && (realToday === 5 || daysLeft <= 1);

      const planLabel = client.plan_name
        ? client.plan_name.replace('Lean Fit', 'Small').replace('Muscle', 'Big').replace('Vegetarian', 'Veg')
        : '';

      let expiryFormatted = '';
      if (client.expiry_date) {
        const d = new Date(client.expiry_date);
        expiryFormatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      }

      let planPrice = 0;
      if (client.plan_id) {
        const pd = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (pd && pd.length > 0) planPrice = pd[0].price || 0;
      }

      this.setData({
        client,
        firstName,
        weekMeals,
        todayDelivery,
        showRenewal,
        daysLeft,
        planLabel,
        planPrice,
        expiryFormatted,
        isUpcoming,
        startDateFormatted,
        loading: false,
        lbl_hi: t('home_hi', firstName),
        lbl_first_delivery: t('home_first_delivery', startDateFormatted),
      });

    } catch (err) {
      console.error('Load client error:', err);
      this.setData({ loading: false });
    }
  },

  // Devuelve la key del próximo día de entrega dentro del ciclo del plan.
  // Si hoy es lunes-viernes y está dentro del plan → hoy.
  // Si hoy es sábado o domingo → el lunes próximo (si cae dentro del plan).
  getPlanDayKey(startDateStr, expiryDateStr) {
    const dowToKey = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay();

    // Encontrar el próximo día hábil (hoy si ya es semana, si no el lunes siguiente)
    let candidate = new Date(today);
    if (dow === 6) candidate.setDate(today.getDate() + 2); // sábado → lunes
    if (dow === 0) candidate.setDate(today.getDate() + 1); // domingo → lunes

    if (startDateStr && expiryDateStr) {
      const start = new Date(startDateStr + 'T00:00:00');
      const expiry = new Date(expiryDateStr + 'T00:00:00');
      if (candidate < start || candidate > expiry) return null;
    }

    return dowToKey[candidate.getDay()] || null;
  },

  async buildWeekMeals(selections, planDayKey) {
    const dayLabelMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

    const allIds = [];
    selections.forEach(s => {
      if (s.meals_json) s.meals_json.forEach(id => { if (id && !allIds.includes(id)) allIds.push(id); });
    });

    let mealMap = {};
    if (allIds.length > 0) {
      const meals = await app.supabase('GET', 'meal_library', null, `id=in.(${allIds.join(',')})`);
      (meals || []).forEach(m => { mealMap[m.id] = m; });
    }

    return DAYS.map(d => {
      const dayLabel = dayLabelMap[d.key];
      const row = selections.find(s => s.day === dayLabel && s.slot === 1);
      const mealIds = row ? (row.meals_json || []) : [];
      const mealNames = mealIds.map(id => {
        if (!mealMap[id]) return null;
        return { name: app.getMealName(mealMap[id]) };
      }).filter(Boolean);
      const photo = mealIds.length > 0 && mealMap[mealIds[0]] ? mealMap[mealIds[0]].photo_url || '' : '';
      const time = row ? row.delivery_time : '';
      const isToday = d.key === planDayKey;
      return { day: d.full, dayShort: d.short, mealNames, time, isToday, photo };
    });
  },

  getTodayDelivery(weekMeals) {
    const todayMeals = weekMeals.find(m => m.isToday);
    if (!todayMeals || !todayMeals.mealNames || todayMeals.mealNames.length === 0) return null;
    return { day: todayMeals.day, time: todayMeals.time };
  },

  getDaysLeft(expiresAt) {
    if (!expiresAt) return 999;
    return Math.ceil((new Date(expiresAt) - new Date()) / 86400000);
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/edit-profile/index' });
  },

  goToMealSelect() {
    wx.showLoading({ title: t('loading') });
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/edit-meals/index' });
    }, 300);
  },

  goToRenewal() {
    wx.navigateTo({ url: '/pages/renewal/index' });
  },

});
