// pages/approved/index.js
const app = getApp();

Page({
  data: {
    order: null,
    firstDeliveryTime: '',
    firstMeals: '',
  },

  async onLoad() {
    const pendingOrderId = wx.getStorageSync('pendingOrderId');
    if (!pendingOrderId) return;

    try {
      const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
      if (!data || data.length === 0) return;

      const order = data[0];
      const selections = order.meals || {};
      const monMeals = selections['mon'] || [];
      const firstDeliveryTime = monMeals.length > 0 ? monMeals[0].time : '—';
      const firstMeals = monMeals.map(s => s.meal ? s.meal.name : '').filter(Boolean).join(' + ');

      this.setData({ order, firstDeliveryTime, firstMeals });
    } catch (err) {
      console.error('Load order error:', err);
    }
  },

  goToPayment() {
    wx.navigateTo({ url: '/pages/payment/index' });
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
