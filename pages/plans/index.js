// pages/plans/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    plans: [],
    loading: true,
    fromRenewal: false,
    tier: null,
    tierZh: null,
    tierColor: null,
    lbl_title: '',
    lbl_subtitle: '',
    lbl_most_popular: '',
    lbl_meals_per_day: '',
    lbl_per_week: '',
    lbl_tap_hint: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('plans_title'),
      lbl_subtitle: t('plans_subtitle'),
      lbl_most_popular: t('plans_most_popular'),
      lbl_meals_per_day: t('plans_meals_per_day'),
      lbl_per_week: t('plans_per_week'),
      lbl_tap_hint: t('plans_tap_hint'),
    });
    const fromRenewal = options.from === 'renewal';
    const tier = options.tier ? decodeURIComponent(options.tier) : null;
    const tierZh = options.tier_zh ? decodeURIComponent(options.tier_zh) : null;
    const tierColor = options.tier_color ? decodeURIComponent(options.tier_color) : null;
    this.setData({ fromRenewal, tier, tierZh, tierColor });
    await this.loadPlans(tier);
  },

  async loadPlans(tier) {
    try {
      const query = tier
        ? `status=eq.Active&tier=eq.${tier}&order=meals.asc`
        : 'status=eq.Active&order=price.asc';
      const data = await app.supabase('GET', 'plans', null, query);

      const tierColor = this.data.tierColor || '#E8342A';
      const plans = (data || []).map((plan) => ({
        ...plan,
        displayName: app.getMealName(plan),
        displayTier: app.getMealName({ name: plan.tier, name_zh: this.data.tierZh || '' }),
        lbl_kcal: plan.kcal ? t('plans_kcal', plan.kcal) : '',
        color: tierColor,
        is_popular: plan.name === 'Small x 2',
      }));

      this.setData({ plans, loading: false });
    } catch (err) {
      console.error('Load plans error:', err);
      this.setData({ loading: false });
      wx.showToast({ title: t('plans_failed'), icon: 'none' });
    }
  },

  selectPlan(e) {
    const plan = e.currentTarget.dataset.plan;
    wx.setStorageSync('selectedPlan', plan);

    const url = this.data.fromRenewal
      ? '/pages/start-date/index?from=renewal&next=meal-select'
      : '/pages/start-date/index?next=meal-select';

    wx.navigateTo({
      url,
      fail: (err) => {
        console.error('navigateTo start-date failed:', err);
        // Retry once
        setTimeout(() => {
          wx.navigateTo({ url });
        }, 500);
      }
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
