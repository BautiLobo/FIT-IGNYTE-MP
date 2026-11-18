// pages/tiers/index.js
const app = getApp();
const t = require('../../i18n/index');

const TIER_COLORS_FALLBACK = {
  'Lean Fit':    '#38BDF8',
  'Muscle Gain': '#FBBF24',
  'Vegetarian':  '#34D399',
};

// "Best for" — 3 bullets por tier, bilingüe vía i18n
const TIER_BEST_FOR_KEYS = {
  'Performance': ['tiers_performance_1', 'tiers_performance_2', 'tiers_performance_3'],
  'Balance': ['tiers_balance_1', 'tiers_balance_2', 'tiers_balance_3'],
};

// kcal y proteína por comida (valores numéricos, iguales en EN y ZH)
const TIER_STATS = {
  'Performance': { kcal: '700–900', protein: '55g+' },
  'Balance':     { kcal: '450–650', protein: '35g+' },
};

// Color del tier con opacidad, para fondos y bordes suaves
function tintOf(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xe8342a;
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

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
    lbl_contact_us: '',
    lbl_best_for: '',
    lbl_see_plans: '',
    lbl_kicker: '',
    lbl_kcal: '',
    lbl_protein: '',
    lbl_menu_pdf: '',
  },

  async onLoad(options) {
    const fromRenewal = (options && options.from === 'renewal') || wx.getStorageSync('flowContext') === 'renewal';
    this.setData({ fromRenewal });
    this.setData({
      lbl_title: t('tiers_title'),
      lbl_heading: t('tiers_heading'),
      lbl_subtitle: t('tiers_subtitle'),
      lbl_tap_hint: t('tiers_tap_hint'),
      lbl_brochure: t('tiers_brochure'),
      lbl_plans_available: t('tiers_plans_available'),
      lbl_contact_us: t('how_contact_us'),
      lbl_best_for: t('tiers_best_for').replace(/[:：]\s*$/, ''),
      lbl_see_plans: t('tiers_see_plans'),
      lbl_kicker: t('tiers_kicker'),
      lbl_kcal: t('tiers_kcal_label'),
      lbl_protein: t('tiers_protein_label'),
      lbl_menu_pdf: t('tiers_menu_pdf'),
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
          const bestForKeys = TIER_BEST_FOR_KEYS[tier.name] || [];
          const stats = TIER_STATS[tier.name] || {};
          const color = tier.color || TIER_COLORS_FALLBACK[tier.name] || '#e8342a';
          return {
            name: tier.name,
            displayName,
            tag: displayName,
            planCount: countMap[tier.name] || 0,
            color,
            tint: tintOf(color, 0.16),
            tintBorder: tintOf(color, 0.45),
            tintStrong: tintOf(color, 0.24),
            cardBorder: tintOf(color, 0.65),
            glow: tintOf(color, 0.35),
            bestFor: bestForKeys.map(key => t(key)),
            kcal: stats.kcal || '',
            protein: stats.protein || '',
          };
        });

      this.setData({ tiers, loading: false });
    } catch (err) {
      console.error('Load tiers error:', err);
      this.setData({ loading: false });
    }
  },

  selectTier(e) {
    const { tier, tierZh, tierColor } = e.currentTarget.dataset;
    const fromRenewal = this.data.fromRenewal;
    if (fromRenewal) wx.setStorageSync('flowContext', 'renewal');
    const renewalParam = fromRenewal ? '&from=renewal' : '';
    wx.navigateTo({ url: '/pages/plans/index?tier=' + encodeURIComponent(tier) + '&tier_zh=' + encodeURIComponent(tierZh || '') + '&tier_color=' + encodeURIComponent(tierColor || '') + renewalParam });
  },

  openBrochure() {
    app.openBrochure();
  },

  goBack() {
    wx.navigateBack();
  },
});
