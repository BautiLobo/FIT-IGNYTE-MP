// pages/payment/index.js
const app = getApp();

Page({
  data: {
    order: null,
    selectedPlan: null,
    total: 0,
    fromRenewal: false,
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    const planPrice = selectedPlan.price || 0;
    const discount = fromRenewal ? 0 : Math.round(planPrice * 0.25);
    const total = planPrice - discount + 35;
    this.setData({ selectedPlan, total, fromRenewal, discount });

    try {
      if (fromRenewal) {
        const clientId = wx.getStorageSync('clientId');
        const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
        if (data && data.length > 0) this.setData({ order: data[0] });
      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        const data = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);
        if (data && data.length > 0) this.setData({ order: data[0] });
      }
    } catch (err) {
      console.error('Load error:', err);
    }
  },

  getExpiryDate() {
    // Use stored expiry date from start-date page if available
    const stored = wx.getStorageSync('expiryDate');
    if (stored) return stored;
    // Fallback: 5 business days from today
    const d = new Date();
    let added = 0;
    while (added < 4) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return d.toISOString().split('T')[0];
  },

  payNow() {
    // Simulate payment — replace with real WeChat Pay when AppSecret is ready
    wx.showModal({
      title: 'Simulate payment?',
      content: 'WeChat Pay not configured yet. Simulate success?',
      confirmText: 'Yes',
      cancelText: 'Cancel',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/pay-processing/index' });
          setTimeout(() => this.handlePaymentSuccess(), 1500);
        }
      }
    });
  },

  async handlePaymentSuccess() {
    const { fromRenewal, selectedPlan } = this.data;
    const nextFriday = this.getExpiryDate();
    const clientId = wx.getStorageSync('clientId');

    try {
      if (fromRenewal) {
        const expiryDate = wx.getStorageSync('expiryDate') || nextFriday;
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, expiryDate);
        console.log('[payment] renewal PATCH clientId:', clientId, 'plan_id:', selectedPlan && selectedPlan.id);
        await app.supabase('PATCH', 'clients', {
          status: realStatus,
          start_date: startDate,
          expiry_date: expiryDate,
          paid: true,
          plan_id: selectedPlan.id,
        }, `id=eq.${clientId}`);
        wx.removeStorageSync('mealSelections');
        wx.removeStorageSync('expiryDate');
        wx.removeStorageSync('startDate');
        wx.showToast({ title: 'Plan renewed!', icon: 'success' });
        setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 1000);

      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        console.log('[payment] pendingOrderId:', pendingOrderId);
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);

        if (!orderData || orderData.length === 0) {
          throw new Error('Order not found — cannot complete payment.');
        }

        const order = orderData[0];
        console.log('[payment] order phone:', order.phone);
        const clientData = await app.supabase('GET', 'clients', null, `phone=eq.${order.phone}`);

        if (!clientData || clientData.length === 0) {
          throw new Error('Client not found for this order.');
        }

        const newClientId = clientData[0].id;
        console.log('[payment] newClientId:', newClientId, 'pendingOrderId:', pendingOrderId);

        // Marcar order como paid
        await app.supabase('PATCH', 'new_orders', { status: 'paid' }, `id=eq.${pendingOrderId}`);

        // Activar cliente
        const startDate = wx.getStorageSync('startDate') || new Date().toISOString().split('T')[0];
        const realStatus = app.getRealStatus(startDate, nextFriday);
        console.log('[payment] PATCH clients with:', JSON.stringify({ status: realStatus, start_date: startDate, expiry_date: nextFriday, paid: true }), 'where id=', newClientId);
        await app.supabase('PATCH', 'clients', {
          status: realStatus,
          start_date: startDate,
          expiry_date: nextFriday,
          paid: true,
        }, `id=eq.${newClientId}`);

        wx.removeStorageSync('startDate');
        wx.removeStorageSync('expiryDate');
        wx.setStorageSync('clientId', newClientId);
        wx.removeStorageSync('pendingOrderId');
        wx.removeStorageSync('selectedPlan');

        // Solo navegamos si todo lo anterior se completó sin lanzar error
        wx.reLaunch({ url: '/pages/welcome/index' });
      }

    } catch (err) {
      console.error('Payment success handler error:', JSON.stringify(err), err.message);
      wx.showModal({
        title: 'Payment error',
        content: err.message || 'Something went wrong saving your data.',
        showCancel: false,
      });
    }
  },

  goBack() {
    wx.navigateBack();
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
