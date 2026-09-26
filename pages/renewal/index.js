// pages/renewal/index.js
const app = getApp();
const t = require('../../i18n/index');

Page({
  data: {
    client: null,
    currentPlanPrice: 0,
    expired: false,
    daysLeft: 0,
    planTier: '',
    planName: '',
    planMeals: 0,
    lbl_title: '',
    lbl_expired: '',
    lbl_due: '',
    lbl_days_left_tag: '',
    lbl_expired_tag: '',
    lbl_cta_expired: '',
    lbl_cta_active: '',
    lbl_current_plan: '',
    lbl_meals_info: '',
    lbl_per_week: '',
    lbl_renew_btn: '',
    lbl_feedback: '',
  },

  async onLoad() {
    this.setData({
      lbl_title: t('renewal_title'),
      lbl_expired: t('renewal_expired'),
      lbl_due: t('renewal_due'),
      lbl_days_left_tag: t('renewal_days_left_tag'),
      lbl_expired_tag: t('renewal_expired_tag'),
      lbl_cta_expired: t('renewal_cta_expired'),
      lbl_cta_active: t('renewal_cta_active'),
      lbl_current_plan: t('renewal_current_plan'),
      lbl_meals_info: t('renewal_meals_info'),
      lbl_per_week: t('renewal_per_week'),
      lbl_renew_btn: t('renewal_renew_btn'),
      lbl_feedback: t('renewal_feedback'),
    });
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.getClient({ clientId });
      if (!data || data.length === 0) return;

      const client = data[0];
      // Comparación por fecha de calendario (medianoche local), no por
      // milisegundos -- `new Date(client.expiry_date)` sin 'T00:00:00' se
      // parsea como UTC; mezclado con `new Date()` (local) esto marcaba el
      // plan como "expirado" desde temprano en la mañana del día en que
      // vence de verdad (huso de Shanghai), en vez de recién al día
      // siguiente -- mismo bug que se encontró y arregló en
      // home.js/getDaysLeft().
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const expiryDate = client.expiry_date ? new Date(client.expiry_date + 'T00:00:00') : null;
      const expired = !expiryDate || today > expiryDate;
      const daysLeft = expiryDate ? Math.max(Math.round((expiryDate - today) / 86400000), 0) : 0;

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
          // OJO: acá NO se guarda `selectedPlan`. Esta pantalla solo muestra
          // el plan actual; el que vale para el flujo lo fija la pantalla de
          // planes, por la que ahora pasa toda renovación. Cuando esto lo
          // escribía, quedaba un plan viejo en storage que podía sobrevivir a
          // un navigateBack (onLoad no vuelve a correr) y mezclarse con lo
          // elegido después.
        }
      }

      this.setData({ client, currentPlanPrice, expired, daysLeft, planTier, planName, planMeals });

    } catch (err) {
      console.error('Load renewal error:', err);
    }
  },

  // Camino ÚNICO de renovación: planes -> fechas -> comidas en blanco.
  // Vale igual con el plan vencido y sin vencer -- la única diferencia entre
  // esos dos casos es en qué tabla terminan las comidas (meal_selections vs
  // pending_meal_selections), y eso lo decide payment.js solo, mirando el
  // expiry; el cliente ve exactamente la misma secuencia de pantallas.
  //
  // Antes había dos botones: "Renovar" (mantener las mismas comidas, que
  // llevaba a edit-meals precargado con el ciclo anterior) y "Cambiar plan".
  // El primero reusaba las filas viejas sin revalidarlas contra el plan
  // elegido, y como todos los chequeos de cantidad eran un mínimo
  // (`>= maxMeals`) y no una igualdad, bajar de plan arrastraba comidas de
  // más: un cliente de producción pagó un plan de 1 comida y quedó cargado
  // con 2 por día. Un solo camino que siempre arranca en blanco elimina esa
  // clase de bug entera en vez de parchear cada punto de reuso.
  startRenewal() {
    wx.setStorageSync('flowContext', 'renewal');
    // Para marcar cuál es su plan actual en la lista de planes.
    const client = this.data.client;
    if (client && client.plan_id) wx.setStorageSync('currentPlanId', client.plan_id);
    // Nada del ciclo anterior sobrevive a este punto.
    wx.removeStorageSync('mealSelections');
    wx.removeStorageSync('selectedDates');
    wx.navigateTo({ url: '/pages/tiers/index?from=renewal' });
  },

  goBack() {
    wx.navigateBack();
  },

});
