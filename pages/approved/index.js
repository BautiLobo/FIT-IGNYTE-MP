// pages/approved/index.js
const app = getApp();

Page({
  data: {
    firstName: '',
    firstMeals: '',
    firstTime: '',
  },

  async onLoad() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (!data || data.length === 0) return;

      const order = data[0];

      // Nombre del cliente
      const firstName = order.name ? order.name.split(' ')[0] : '';

      // Primera entrega — buscar en meals del order (estructura: { mon: { meal_ids, time, ... } })
      let firstMeals = '';
      let firstTime = '09:45';
      const meals = order.meals || {};
      const monData = meals['mon'];
      if (monData) {
        firstTime = monData.time || '09:45';
        const mealIds = monData.meal_ids || [];
        if (mealIds.length > 0) {
          const mealData = await app.supabase('GET', 'meal_library', null, `id=in.(${mealIds.join(',')})`);
          if (mealData && mealData.length > 0) {
            firstMeals = mealData.map(m => m.name).join(' + ');
          }
        }
      }

      this.setData({ firstName, firstMeals, firstTime });
    } catch (err) {
      console.error('approved onLoad error:', err);
    }
  },

  goToPayment() {
    wx.showLoading({ title: 'Loading...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/payment/index' });
    }, 300);
  },

});
