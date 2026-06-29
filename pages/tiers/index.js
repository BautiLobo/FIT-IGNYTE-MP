// pages/tiers/index.js
const app = getApp();

// Mismos colores base que usa plans/index.js por tier
const TIER_COLORS = {
  'Lean Fit':    '#38BDF8',
  'Muscle Gain': '#FBBF24',
  'Vegetarian':  '#34D399',
};

Page({
  data: {
    loading: true,
    tiers: [],
  },

  async onLoad() {
    await this.loadTiers();
  },

  async loadTiers() {
    try {
      const data = await app.supabase('GET', 'plans', null, 'status=eq.Active');
      const plans = data || [];

      // Group by tier and count plans per tier
      const tierMap = {};
      plans.forEach(p => {
        if (!p.tier) return;
        if (!tierMap[p.tier]) tierMap[p.tier] = 0;
        tierMap[p.tier]++;
      });

      const tiers = Object.entries(tierMap).map(([name, count]) => ({
        name,
        tag: name.toUpperCase(),
        planCount: count,
        color: TIER_COLORS[name] || '#e8342a',
      }));

      this.setData({ tiers, loading: false });
    } catch (err) {
      console.error('Load tiers error:', err);
      this.setData({ loading: false });
    }
  },

  selectTier(e) {
    const tier = e.currentTarget.dataset.tier;
    if (this.data.fromRenewal) wx.setStorageSync('flowContext', 'renewal');
    wx.navigateTo({ url: '/pages/plans/index?tier=' + encodeURIComponent(tier) });
  },

  openBrochure() {
    wx.showLoading({ title: 'Loading...' });
    app.supabase('GET', 'settings', null, 'key=eq.brochure_en')
      .then(data => {
        wx.hideLoading();
        if (data && data.length > 0 && data[0].value) {
          wx.downloadFile({
            url: data[0].value,
            success: (res) => {
              wx.openDocument({
                filePath: res.tempFilePath,
                showMenu: true,
                fail: (err) => {
                  console.error('openDocument error:', err);
                  wx.showToast({ title: err.errMsg || 'Failed to open', icon: 'none' });
                }
              });
            },
            fail: (err) => {
              console.error('downloadFile error:', err);
              wx.showToast({ title: err.errMsg || 'Failed to download', icon: 'none' });
            }
          });
        } else {
          wx.showToast({ title: 'Brochure not found', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: 'Failed to load', icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack();
  },
});
