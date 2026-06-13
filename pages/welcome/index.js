// pages/welcome/index.js
const app = getApp();

Page({
  data: {
    clientName: '',
    firstTime: '',
    firstMeals: '',
  },

  async onLoad() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    const clientId = wx.getStorageSync('clientId');

    try {
      if (pendingOrderId) {
        // New client — load from new_orders
        const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (data && data.length > 0) {
          const order = data[0];
          const selections = order.meals || {};
          const monMeals = selections['mon'] || [];
          const firstTime = monMeals.length > 0 ? monMeals[0].time : '09:45';
          const firstMeals = monMeals.map(s => s.meal ? '🍽️ ' + s.meal.name : '').filter(Boolean).join(' + ');

          wx.removeStorageSync('pendingOrderId');
          wx.removeStorageSync('selectedPlan');

          this.setData({
            clientName: order.name ? order.name.split(' ')[0] : 'there',
            firstTime,
            firstMeals,
          });
        }
      } else if (clientId) {
        // Load from clients table
        const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
        if (data && data.length > 0) {
          const client = data[0];
          const selections = client.meal_selections || {};
          const monMeals = selections['mon'] || [];
          const firstTime = monMeals.length > 0 ? monMeals[0].time : '09:45';
          const firstMeals = monMeals.map(s => s.meal ? '🍽️ ' + s.meal.name : '').filter(Boolean).join(' + ');

          this.setData({
            clientName: client.name ? client.name.split(' ')[0] : 'there',
            firstTime,
            firstMeals,
          });
        }
      } else {
        // No data — show generic welcome
        this.setData({ clientName: 'there', firstTime: '09:45', firstMeals: '' });
      }
    } catch (err) {
      console.error('Welcome load error:', err);
      this.setData({ clientName: 'there', firstTime: '09:45', firstMeals: '' });
    }
  },

  goToHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
