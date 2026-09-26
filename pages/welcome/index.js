// pages/welcome/index.js
const app = getApp();
const t = require('../../i18n/index');
const { formatShortDate } = require('../../utils/date-format');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');

Page({
  data: {
    clientName: '',
    firstDay: 'Monday',
    firstTime: '09:45',
    firstMeals: '',
    lbl_title: '',
    lbl_go_home: '',
  },

  async onLoad() {
    this.setData({ lbl_go_home: t('welcome_go_home') });
    // Limpiar storage de orden pendiente
    wx.removeStorageSync('pendingOrderId');
    wx.removeStorageSync('selectedPlan');

    try {
      await this.loadWelcomeData();
    } catch (err) {
      console.error('Welcome load error:', err);
      this.setData({ clientName: 'there' });
    }
  },

  async loadWelcomeData() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) {
      this.setData({ clientName: 'there' });
      return;
    }

    // Cargar cliente
    const clientData = await app.getClient({ clientId });
    if (!clientData || clientData.length === 0) return;
    const client = clientData[0];
    const firstName = client.name ? client.name.split(' ')[0] : 'there';

    // Cargar primera meal selection
    const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&delivery_date=not.is.null&order=delivery_date.asc&limit=1`);
    if (!selectionsData || selectionsData.length === 0) {
      this.setData({ clientName: firstName });
      return;
    }

    const first = selectionsData[0];
    const firstDay = first.delivery_date ? formatShortDate(first.delivery_date, _isZh ? 'zh' : 'en') : '';
    const firstTime = first.delivery_time || '09:45';
    const mealIds = first.meals_json || [];

    let firstMeals = '';
    if (mealIds.length > 0) {
      const mealsData = await app.supabase('GET', 'meal_library', null, `id=in.(${mealIds.join(',')})`);
      if (mealsData && mealsData.length > 0) {
        const mealMap = {};
        mealsData.forEach(m => { mealMap[m.id] = m; });
        firstMeals = mealIds.map(id => mealMap[id] ? app.getMealName(mealMap[id]) : '').filter(Boolean).join(' + ');
      }
    }

    this.setData({ clientName: firstName, firstDay, firstTime, firstMeals, lbl_title: t('welcome_title', firstName) });
  },

  goToHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
