// pages/renewal/index.js
const app = getApp();

Page({
  data: {
    client: null,
    currentPlanPrice: 0,
    expired: false,
    planTier: '',
    planName: '',
    planMeals: 0,
  },

  async onLoad() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.getClient({ clientId });
      if (!data || data.length === 0) return;

      const client = data[0];
      const expired = !client.expiry_date || new Date(client.expiry_date) < new Date();

      // Load current plan price
      let currentPlanPrice = 0, planTier = '', planName = '', planMeals = 0;
      if (client.plan_id) {
        const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (planData && planData.length > 0) {
          const plan = planData[0];
          currentPlanPrice = plan.price;
          planTier = (plan.tier || '').toUpperCase();
          planName = plan.name || '';
          planMeals = plan.meals || 0;
          wx.setStorageSync('selectedPlan', plan);
        }
      }

      this.setData({ client, currentPlanPrice, expired, planTier, planName, planMeals });

    } catch (err) {
      console.error('Load renewal error:', err);
    }
  },

  keepSameMeals() {
    wx.navigateTo({ url: '/pages/edit-meals/index?from=renewal' });
  },

  choosNewMeals() {
    wx.navigateTo({ url: '/pages/meal-select/index?from=renewal' });
  },

  changePlan() {
    wx.setStorageSync('flowContext', 'renewal');
    wx.setStorageSync('renewalFreshMeals', true);
    wx.removeStorageSync('mealSelections');
    wx.navigateTo({ url: '/pages/tiers/index?from=renewal' });
  },

  goBack() {
    wx.navigateBack();
  },

});
