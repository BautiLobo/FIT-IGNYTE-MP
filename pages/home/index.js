// pages/home/index.js
const app = getApp();

const DAYS = [
  { key: 'mon', short: 'MON', full: 'Monday', idx: 1 },
  { key: 'tue', short: 'TUE', full: 'Tuesday', idx: 2 },
  { key: 'wed', short: 'WED', full: 'Wednesday', idx: 3 },
  { key: 'thu', short: 'THU', full: 'Thursday', idx: 4 },
  { key: 'fri', short: 'FRI', full: 'Friday', idx: 5 },
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
  },

  async onLoad() {
    await this.loadClientData();
    await this.loadNotifications();
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
      const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
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
        const d = new Date(client.start_date);
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
      });

    } catch (err) {
      console.error('Load client error:', err);
      this.setData({ loading: false });
    }
  },

  // Devuelve la key de día (mon/tue/wed/thu/fri) que corresponde a "hoy" dentro del ciclo del plan,
  // o null si hoy cae fuera del rango start_date — expiry_date, o si hoy es fin de semana.
  getPlanDayKey(startDateStr, expiryDateStr) {
    const realToday = new Date();
    realToday.setHours(0, 0, 0, 0);
    const dow = realToday.getDay(); // 0=Sun ... 6=Sat
    if (dow === 0 || dow === 6) return null;

    if (startDateStr && expiryDateStr) {
      const start = new Date(startDateStr + 'T00:00:00');
      const expiry = new Date(expiryDateStr + 'T00:00:00');
      if (realToday < start || realToday > expiry) return null;
    }

    const map = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
    return map[dow] || null;
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
      const mealNames = mealIds.map(id => mealMap[id] ? mealMap[id].name : '').filter(Boolean);
      const photo = mealIds.length > 0 && mealMap[mealIds[0]] ? mealMap[mealIds[0]].photo_url || '' : '';
      const time = row ? row.delivery_time : '';
      const isToday = d.key === planDayKey;
      return { day: d.full, dayShort: d.short, mealNames, time, snack: null, isToday, photo };
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
    wx.showLoading({ title: 'Loading...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/edit-meals/index' });
    }, 300);
  },

  goToRenewal() {
    wx.navigateTo({ url: '/pages/renewal/index' });
  },

  contactUs() {
    wx.showModal({
      title: 'Contact us on WeChat',
      content: 'Search for: fitignyte_shanghai',
      showCancel: false,
      confirmText: 'OK',
    });
  },
});
