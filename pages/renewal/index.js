// pages/renewal/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    client: null,
    currentPlanPrice: 0,
    expired: false,
    planTier: '',
    planName: '',
    planMeals: 0,
    lbl_title: '',
    lbl_expired: '',
    lbl_due: '',
    lbl_cta_expired: '',
    lbl_cta_active: '',
    lbl_current_plan: '',
    lbl_meals_info: '',
    lbl_per_week: '',
    lbl_renew_btn: '',
    lbl_change_plan: '',
    lbl_feedback: '',
  },

  async onLoad() {
    this.setData({
      lbl_title: t('renewal_title'),
      lbl_expired: t('renewal_expired'),
      lbl_due: t('renewal_due'),
      lbl_cta_expired: t('renewal_cta_expired'),
      lbl_cta_active: t('renewal_cta_active'),
      lbl_current_plan: t('renewal_current_plan'),
      lbl_meals_info: t('renewal_meals_info'),
      lbl_per_week: t('renewal_per_week'),
      lbl_renew_btn: t('renewal_renew_btn'),
      lbl_change_plan: t('renewal_change_plan'),
      lbl_feedback: t('renewal_feedback'),
    });
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
          const plan = app.getDisplayPlan(planData[0]);
          currentPlanPrice = plan.price;
          planTier = plan.displayTier || plan.tier || '';
          planName = plan.displayName || plan.name || '';
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
    wx.navigateTo({ url: '/pages/start-date/index?from=renewal&next=edit-meals' });
  },

  choosNewMeals() {
    wx.navigateTo({ url: '/pages/start-date/index?from=renewal&next=meal-select' });
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
