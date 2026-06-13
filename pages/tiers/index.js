// pages/tiers/index.js
const app = getApp();

const TIER_COLORS = {
  default: '#e8342a',
};

// Assign colors by index for variety
const COLORS = ['#38BDF8', '#e8342a', '#34D399', '#FBBF24', '#A78BFA'];

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

      const tiers = Object.entries(tierMap).map(([name, count], i) => ({
        name,
        planCount: count,
        color: COLORS[i % COLORS.length],
      }));

      this.setData({ tiers, loading: false });
    } catch (err) {
      console.error('Load tiers error:', err);
      this.setData({ loading: false });
    }
  },

  selectTier(e) {
    const tier = e.currentTarget.dataset.tier;
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
              wx.openDocument({ filePath: res.tempFilePath, showMenu: true });
            },
            fail: () => wx.showToast({ title: 'Failed to open', icon: 'none' })
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
