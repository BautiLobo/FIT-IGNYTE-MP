// pages/plans/index.js
const app = getApp();

const PLAN_COLORS = {
  'Lean Fit':     ['#38BDF8', '#A78BFA', '#60A5FA'],
  'Muscle Gain':  ['#FBBF24', '#FB923C'],
  'Vegetarian':   ['#34D399'],
};

Page({
  data: {
    plans: [],
    loading: true,
    fromRenewal: false,
    tier: null,
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal';
    const tier = options.tier ? decodeURIComponent(options.tier) : null;
    console.log('[plans] tier:', tier);
    this.setData({ fromRenewal, tier });
    await this.loadPlans(tier);
  },

  async loadPlans(tier) {
    try {
      const query = tier
        ? `status=eq.Active&tier=eq.${tier}&order=meals.asc`
        : 'status=eq.Active&order=price.asc';
      const data = await app.supabase('GET', 'plans', null, query);

      const colorIndex = {};
      const plans = (data || []).map((plan) => {
        const cat = plan.tier || 'Lean Fit';
        if (!colorIndex[cat]) colorIndex[cat] = 0;
        const colors = PLAN_COLORS[cat] || ['#E8342A'];
        const color = colors[colorIndex[cat] % colors.length];
        colorIndex[cat]++;
        return {
          ...plan,
          color,
          is_popular: plan.name === 'Small x 2',
        };
      });

      this.setData({ plans, loading: false });
    } catch (err) {
      console.error('Load plans error:', err);
      this.setData({ loading: false });
      wx.showToast({ title: 'Failed to load plans', icon: 'none' });
    }
  },

  selectPlan(e) {
    const plan = e.currentTarget.dataset.plan;
    wx.setStorageSync('selectedPlan', plan);

    if (this.data.fromRenewal) {
      wx.showModal({
        title: 'Same meals as last week?',
        content: 'Do you want to keep the same meal selections or choose new ones?',
        confirmText: 'Choose new',
        cancelText: 'Keep same',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/meal-select/index?from=renewal' });
          } else {
            wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
          }
        }
      });
    } else {
      wx.navigateTo({ url: '/pages/meal-select/index' });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
