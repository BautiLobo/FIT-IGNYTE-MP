// pages/welcome/index.js
const app = getApp();

const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

Page({
  data: {
    clientName: '',
    firstDay: 'Monday',
    firstTime: '09:45',
    firstMeals: '',
  },

  async onLoad() {
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
    const clientData = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
    if (!clientData || clientData.length === 0) return;
    const client = clientData[0];
    const firstName = client.name ? client.name.split(' ')[0] : 'there';

    // Cargar primera meal selection
    const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc&limit=1`);
    if (!selectionsData || selectionsData.length === 0) {
      this.setData({ clientName: firstName });
      return;
    }

    const first = selectionsData[0];
    const firstDay = DAY_LABELS[first.day] || first.day || 'Monday';
    const firstTime = first.delivery_time || '09:45';
    const mealIds = first.meals_json || [];

    // Cargar nombres de meals
    let firstMeals = '';
    if (mealIds.length > 0) {
      const mealsData = await app.supabase('GET', 'meal_library', null, `id=in.(${mealIds.join(',')})`);
      if (mealsData && mealsData.length > 0) {
        firstMeals = mealsData.map(m => m.name).join(' + ');
      }
    }

    this.setData({ clientName: firstName, firstDay, firstTime, firstMeals });
  },

  goToHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
