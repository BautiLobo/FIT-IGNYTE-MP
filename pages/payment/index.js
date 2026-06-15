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
        const mealSelections = wx.getStorageSync('mealSelections') || null;
        const updateData = {
          status: 'Active',
          expiry_date: nextFriday,
            paid: true,
          plan_id: selectedPlan.id,
          plan_id: selectedPlan.id,
        };
        if (mealSelections) {
          // meal_selections now in meal_selections table
          wx.removeStorageSync('mealSelections');
        }
        await app.supabase('PATCH', 'clients', updateData, `id=eq.${clientId}`);
        wx.reLaunch({ url: '/pages/home/index' });

      } else {
        const pendingOrderId = wx.getStorageSync('pendingOrderId');
        const orderData = await app.supabase('GET', 'new_orders', null, `id=eq.${pendingOrderId}`);

        if (orderData && orderData.length > 0) {
          const order = orderData[0];
          const clientData = await app.supabase('GET', 'clients', null, `phone=eq.${order.phone}`);

          if (clientData && clientData.length > 0) {
            const newClientId = clientData[0].id;

            // Marcar order como paid
            await app.supabase('PATCH', 'new_orders', { status: 'paid' }, `id=eq.${pendingOrderId}`);

            // Activar cliente
            await app.supabase('PATCH', 'clients', {
              status: 'Active',
              expiry_date: nextFriday,
              paid: true,
            }, `id=eq.${newClientId}`);

            wx.setStorageSync('clientId', newClientId);
            wx.removeStorageSync('pendingOrderId');
            wx.removeStorageSync('selectedPlan');
          }
        }

        wx.reLaunch({ url: '/pages/welcome/index' });
      }

    } catch (err) {
      console.error('Payment success handler error:', err);
      wx.showToast({ title: 'Something went wrong', icon: 'none' });
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
