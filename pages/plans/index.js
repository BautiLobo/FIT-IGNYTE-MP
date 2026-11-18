// pages/plans/index.js
const app = getApp();
const t = require('../../i18n/index');

// Frases hook por cantidad de comidas, en vez de "X meal(s)/day".
// Distintas por tier: Balance (mantenimiento/día a día) vs Performance (rendimiento/músculo).
const MEALS_HOOK_KEYS = {
  Balance: {
    1: 'plans_hook_balance_1',
    2: 'plans_hook_balance_2',
    3: 'plans_hook_balance_3',
  },
  Performance: {
    1: 'plans_hook_performance_1',
    2: 'plans_hook_performance_2',
    3: 'plans_hook_performance_3',
  },
};

// Proteína mínima por comida, por tier — igual que el rango mostrado en la
// pantalla de tiers (35g+/comida Balance, 55g+/comida Performance). La
// proteína/día de cada plan es ese valor × cantidad de comidas del plan.
const PROTEIN_PER_MEAL = { Balance: 35, Performance: 55 };

// Color con opacidad, para fondos y bordes suaves (igual que en tiers)
function tintOf(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xe8342a;
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

// "LEAN STARTER x 1 MEAL" / "轻盈入门版 - 每天 1 餐" -> título ("LEAN STARTER").
// Si el nombre no tiene separador, va entero como título.
function splitPlanName(name) {
  const parts = String(name || '').split(/\s+[xX×\-–]\s+/);
  if (parts.length < 2) return { title: name || '', mealsLabel: '' };
  return { title: parts[0], mealsLabel: parts.slice(1).join(' ') };
}

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
    lbl_current_plan: '',
    lbl_kicker: '',
    lbl_kcal_day: '',
    lbl_protein_day: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('plans_title'),
      lbl_subtitle: t('plans_subtitle'),
      lbl_most_popular: t('plans_most_popular'),
      lbl_meals_per_day: t('plans_meals_per_day'),
      lbl_per_week: t('plans_per_week'),
      lbl_tap_hint: t('plans_tap_hint'),
      lbl_current_plan: t('plans_current_plan'),
      lbl_kicker: t('plans_kicker'),
      lbl_kcal_day: t('plans_kcal_day_label'),
      lbl_protein_day: t('plans_protein_day_label'),
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
      const currentPlanId = this.data.fromRenewal ? wx.getStorageSync('currentPlanId') : '';
      const plans = (data || []).map((plan) => {
        const displayName = app.getMealName(plan);
        const color = plan.color || tierColor;
        return {
        ...plan,
        displayName,
        // Título sin el "x N MEALS" del nombre; la cantidad va como "N meals per day"
        title: splitPlanName(displayName).title,
        mealsLabel: plan.meals ? t(plan.meals === 1 ? 'plans_meal_per_day_1' : 'plans_meal_per_day_n', plan.meals) : '',
        tint: tintOf(color, 0.16),
        tintBorder: tintOf(color, 0.45),
        proteinDay: (PROTEIN_PER_MEAL[plan.tier] || 0) * (plan.meals || 0),
        displayTier: app.getMealName({ name: plan.tier, name_zh: this.data.tierZh || '' }),
        lbl_kcal: plan.kcal ? t('plans_kcal', plan.kcal, (PROTEIN_PER_MEAL[plan.tier] || 0) * (plan.meals || 0)) : '',
        // Frase hook por tier + cantidad de comidas, fallback a "X meal(s)/day"
        mealsHook: (() => {
          const key = MEALS_HOOK_KEYS[plan.tier] && MEALS_HOOK_KEYS[plan.tier][plan.meals];
          return key ? t(key) : `${plan.meals} ${t('plans_meals_per_day')}`;
        })(),
        // Color propio de cada plan desde la DB; fallback al color del tier
        color,
        is_popular: plan.name === 'Small x 2',
        // Renovación: el plan que está corriendo hoy va marcado, para que
        // confirmarlo sea tan directo como cambiarlo. Lo deja guardado
        // startRenewal() en renewal/index.js; en un alta nueva no existe y
        // ningún plan queda marcado.
        is_current: !!currentPlanId && plan.id === currentPlanId,
        };
      });

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
      ? '/pages/start-date/index?from=renewal'
      : '/pages/start-date/index';

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
