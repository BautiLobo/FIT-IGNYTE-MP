// pages/renewal/index.js
const app = getApp();

Page({
  data: {
    client: null,
    currentPlanPrice: 0,
    expired: false,
  },

  async onLoad() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
      if (!data || data.length === 0) return;

      const client = data[0];
      const expired = !client.expiry_date || new Date(client.expiry_date) < new Date();

      // Load current plan price
      let currentPlanPrice = 0;
      if (client.plan_id) {
        const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (planData && planData.length > 0) {
          currentPlanPrice = planData[0].price;
          // Save full plan object for later use
          wx.setStorageSync('selectedPlan', planData[0]);
        }
      }

      this.setData({ client, currentPlanPrice, expired });

    } catch (err) {
      console.error('Load renewal error:', err);
    }
  },

  renewSamePlan() {
    // Ask if they want to repeat same meals
    wx.showModal({
      title: 'Same meals as last week?',
      content: 'Do you want to keep the same meal selections or choose new ones?',
      confirmText: 'Choose new',
      cancelText: 'Keep same',
      success: (res) => {
        if (res.confirm) {
          // Choose new meals
          wx.navigateTo({ url: '/pages/meal-select/index?from=renewal' });
        } else {
          // Keep same meals — go straight to payment
          wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
        }
      }
    });
  },

  changePlan() {
    wx.navigateTo({ url: '/pages/plans/index?from=renewal' });
  },

  goBack() {
    wx.navigateBack();
  },
});
