// pages/home/index.js
const app = getApp();

const DAYS = [
  { key: 'mon', short: 'MON', full: 'Monday' },
  { key: 'tue', short: 'TUE', full: 'Tuesday' },
  { key: 'wed', short: 'WED', full: 'Wednesday' },
  { key: 'thu', short: 'THU', full: 'Thursday' },
  { key: 'fri', short: 'FRI', full: 'Friday' },
];

Page({
  data: {
    loading: true,
    client: null,
    firstName: '',
    weekNumber: '',
    weekMeals: [],
    todayDelivery: null,
    showRenewal: false,
    daysLeft: 0,
  },

  async onLoad() {
    await this.loadClientData();
  },

  onShow() {
    this.loadClientData();
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

      // Get plan name from plans table
      if (client.plan_id) {
        const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (planData && planData.length > 0) {
          client.plan_name = planData[0].name;
        }
      }
      // Load meal selections from meal_selections table
      const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc,slot.asc`);
      const selections = selectionsData || [];

      const firstName = client.name ? client.name.split(' ')[0] : 'there';
      const weekNumber = this.getWeekNumber();
      const weekMeals = await this.buildWeekMeals(selections);
      const todayDelivery = this.getTodayDelivery(weekMeals);
      const daysLeft = this.getDaysLeft(client.expiry_date);

      // Show renewal banner on Fridays or if 1 day left
      const today = new Date().getDay();
      const showRenewal = today === 5 || daysLeft <= 1;

      // Plan label: "Small × 2"
      const planLabel = client.plan_name
        ? client.plan_name.replace('Lean Fit', 'Small').replace('Muscle', 'Big').replace('Vegetarian', 'Veg')
        : '';

      // Expiry formatted: "Friday, Jun 20"
      let expiryFormatted = '';
      if (client.expiry_date) {
        const d = new Date(client.expiry_date);
        expiryFormatted = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      }

      // Plan price from plans table
      let planPrice = 0;
      if (client.plan_id) {
        const pd = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (pd && pd.length > 0) planPrice = pd[0].price || 0;
      }

      this.setData({
        client,
        firstName,
        weekNumber,
        weekMeals,
        todayDelivery,
        showRenewal,
        daysLeft,
        planLabel,
        planPrice,
        expiryFormatted,
        loading: false,
      });

    } catch (err) {
      console.error('Load client error:', err);
      this.setData({ loading: false });
    }
  },

  async buildWeekMeals(selections) {
    const today = new Date().getDay();
    const dayIndexMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
    const dayLabelMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

    // Collect all meal IDs
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
      // meal_selections table: one row per day (slot=1)
      const row = selections.find(s => s.day === dayLabel && s.slot === 1);
      const mealIds = row ? (row.meals_json || []) : [];
      const meal1 = mealIds.map(id => mealMap[id] ? mealMap[id].name : '').filter(Boolean).join(' + ');
      const photo = mealIds.length > 0 && mealMap[mealIds[0]] ? mealMap[mealIds[0]].photo_url || '' : '';
      const time = row ? row.delivery_time : '';
      const isToday = dayIndexMap[d.key] === today;
      return { day: d.full, dayShort: d.short, meal1, meal2: '', time, snack: null, isToday, photo };
    });
  },

  getTodayDelivery(weekMeals) {
    const today = new Date().getDay();
    const dayIndexMap = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
    if (!dayIndexMap[today]) return null;
    const todayMeals = weekMeals.find(m => m.day === dayIndexMap[today]);
    if (!todayMeals || !todayMeals.meal1) return null;
    return { day: todayMeals.day, time: todayMeals.time };
  },

  getWeekNumber() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
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
