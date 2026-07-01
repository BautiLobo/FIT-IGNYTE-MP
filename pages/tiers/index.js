// pages/tiers/index.js
const app = getApp();
const t = require('../../i18n/index');

const TIER_COLORS_FALLBACK = {
  'Lean Fit':    '#38BDF8',
  'Muscle Gain': '#FBBF24',
  'Vegetarian':  '#34D399',
};

Page({
  data: {
    loading: true,
    tiers: [],
    lbl_title: '',
    lbl_heading: '',
    lbl_subtitle: '',
    lbl_tap_hint: '',
    lbl_brochure: '',
    lbl_plans_available: '',
  },

  async onLoad() {
    this.setData({
      lbl_title: t('tiers_title'),
      lbl_heading: t('tiers_heading'),
      lbl_subtitle: t('tiers_subtitle'),
      lbl_tap_hint: t('tiers_tap_hint'),
      lbl_brochure: t('tiers_brochure'),
      lbl_plans_available: t('tiers_plans_available'),
    });
    await this.loadTiers();
  },

  async loadTiers() {
    try {
      const [tiersData, plansData] = await Promise.all([
        app.supabase('GET', 'tiers', null, 'order=name.asc'),
        app.supabase('GET', 'plans', null, 'status=eq.Active&select=tier'),
      ]);

      // Count active plans per tier name
      const countMap = {};
      (plansData || []).forEach(p => {
        if (!p.tier) return;
        countMap[p.tier] = (countMap[p.tier] || 0) + 1;
      });

      const tiers = (tiersData || [])
        .filter(tier => countMap[tier.name] > 0)
        .map(tier => {
          const displayName = app.getMealName({ name: tier.name, name_zh: tier.name_zh });
          return {
            name: tier.name,
            displayName,
            tag: displayName,
            planCount: countMap[tier.name] || 0,
            color: tier.color || TIER_COLORS_FALLBACK[tier.name] || '#e8342a',
          };
        });

      this.setData({ tiers, loading: false });
    } catch (err) {
      console.error('Load tiers error:', err);
      this.setData({ loading: false });
    }
  },

  selectTier(e) {
    const { tier, tierZh } = e.currentTarget.dataset;
    if (this.data.fromRenewal) wx.setStorageSync('flowContext', 'renewal');
    wx.navigateTo({ url: '/pages/plans/index?tier=' + encodeURIComponent(tier) + '&tier_zh=' + encodeURIComponent(tierZh || '') });
  },

  openBrochure() {
    wx.showLoading({ title: t('loading') });
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
                  wx.showToast({ title: err.errMsg || t('failed_open'), icon: 'none' });
                }
              });
            },
            fail: (err) => {
              console.error('downloadFile error:', err);
              wx.showToast({ title: err.errMsg || t('failed_download'), icon: 'none' });
            }
          });
        } else {
          wx.showToast({ title: t('brochure_not_found'), icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: t('failed_load'), icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack();
  },
});
