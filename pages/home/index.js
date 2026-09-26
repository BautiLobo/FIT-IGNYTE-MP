// pages/home/index.js
const app = getApp();
const t = require('../../i18n/index');
const { toDateString } = require('../../utils/business-days');
const { formatShortDate } = require('../../utils/date-format');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');

Page({
  data: {
    loading: true,
    client: null,
    firstName: '',
    weekMeals: [],
    todayDelivery: null,
    showRenewal: false,
    hasPendingRenewal: false,
    daysLeft: 0,
    notifications: [],
    lbl_hi: '',
    lbl_active: '',
    lbl_upcoming: '',
    lbl_plan_starts_soon: '',
    lbl_first_delivery: '',
    lbl_this_weeks_meals: '',
    lbl_edit: '',
    lbl_contact: '',
    lbl_view_menu: '',
    lbl_renewal_title: '',
    lbl_renewal_sub: '',
    lbl_renewal_btn: '',
    lbl_renewal_pending_title: '',
    lbl_renewal_pending_sub: '',
  },

  async onLoad() {
    this.setData({
      lbl_active: t('home_active'),
      lbl_upcoming: t('home_upcoming'),
      lbl_plan_starts_soon: t('home_plan_starts_soon'),
      lbl_this_weeks_meals: t('home_this_weeks_meals'),
      lbl_edit: t('home_edit'),
      lbl_contact: t('home_contact'),
      lbl_view_menu: t('home_view_menu'),
      lbl_renewal_title: t('home_renewal_title'),
      lbl_renewal_btn: t('home_renewal_btn'),
      lbl_renewal_pending_title: t('home_renewal_pending_title'),
    });
    await this.loadClientData();
    await this.loadNotifications();
    const clientId = wx.getStorageSync('clientId');
    if (clientId) {
      app.captureOpenid(clientId);
    }
  },

  onShow() {
    this.loadClientData();
    this.loadNotifications();
  },

  async loadNotifications() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) return;

    try {
      const data = await app.getNotifications({ clientId });
      this.setData({ notifications: data || [] });
    } catch (err) {
      console.error('Load notifications error:', err);
    }
  },

  async dismissNotification(e) {
    const id = e.currentTarget.dataset.id;
    const notifications = this.data.notifications.filter(n => n.id !== id);
    this.setData({ notifications });

    try {
      await app.markNotificationRead({ id });
    } catch (err) {
      console.error('Dismiss notification error:', err);
    }
  },

  async loadClientData() {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) {
      wx.reLaunch({ url: '/pages/discovery/index' });
      return;
    }

    try {
      const data = await app.getClient({ clientId });
      if (!data || data.length === 0) {
        wx.reLaunch({ url: '/pages/discovery/index' });
        return;
      }

      const client = data[0];

      const firstName = client.name ? client.name.split(' ')[0] : 'there';
      const daysLeft = this.getDaysLeft(client.expiry_date);
      const realStatus = app.getRealStatus(client.start_date, client.expiry_date);

      // Renovación anticipada ya pagada pero todavía sin aplicar (el cron
      // diario la aplica el día que corresponde -- ver RENEWAL_PLAN.md,
      // decisión 4). `get-client` ya adjunta este chequeo en la misma
      // respuesta. Mientras esté presente, no hay que ofrecer renovar de
      // nuevo (create-payment lo bloquearía igual, pero mejor no llegar ni
      // a mostrar el botón).
      const pendingRenewal = client.pending_renewal || null;
      const hasPendingRenewal = !!pendingRenewal;
      let pendingRenewalDateFormatted = '';
      if (pendingRenewal && pendingRenewal.start_date) {
        pendingRenewalDateFormatted = this.formatFullDate(new Date(pendingRenewal.start_date + 'T00:00:00'));
      }

      // Hueco entre el vencimiento del ciclo viejo y el arranque del nuevo ya
      // pagado: `realStatus` da 'Inactive' porque solo mira start/expiry del
      // ciclo viejo, pero para el cliente esto es indistinguible de estar
      // 'Upcoming' -- mismo trato: banner "starts soon" + comidas de la
      // semana que viene, tomadas de `pending_meal_selections` porque el
      // cron todavía no las migró a `meal_selections`.
      const inRenewalGap = realStatus === 'Inactive' && hasPendingRenewal;
      const isUpcoming = realStatus === 'Upcoming' || inRenewalGap;
      const effectiveStartDate = inRenewalGap ? pendingRenewal.start_date : client.start_date;

      // El nombre de plan a mostrar tiene que ser el del ciclo que este
      // texto describe: en el hueco eso es el ciclo nuevo (pending_renewal),
      // no client.plan_id -- ese sigue siendo el plan VIEJO hasta que el
      // cron aplica el cambio. Mismo criterio que edit-meals.js.
      const planIdToShow = (inRenewalGap && pendingRenewal.plan_id) ? pendingRenewal.plan_id : client.plan_id;
      if (planIdToShow) {
        const planData = await app.supabase('GET', 'plans', null, `id=eq.${planIdToShow}`);
        if (planData && planData.length > 0) {
          client.plan_name = app.getMealName(planData[0]);
        }
      }

      const selectionsTable = inRenewalGap ? 'pending_meal_selections' : 'meal_selections';
      const selectionsData = await app.supabase('GET', selectionsTable, null, `client_id=eq.${clientId}&order=delivery_date.asc,slot.asc`);
      // Acotar al ciclo vigente. `meal_selections` puede tener filas de otro
      // ciclo: un cliente con una renovación anticipada ya paga, o slots
      // cargados desde el panel para fechas posteriores a su expiry. Sin
      // esto, "This week's meals" listaba entregas que no son de esta
      // semana -- el caso visto: ciclo 15→21 sept mostrando también el 23.
      //
      // `pending_meal_selections` no necesita filtro: se vacía al aplicarse,
      // así que todo lo que tiene pertenece al ciclo que todavía no arrancó.
      const selections = inRenewalGap
        ? (selectionsData || [])
        : (selectionsData || []).filter((s) => (
            (!client.start_date || s.delivery_date >= client.start_date) &&
            (!client.expiry_date || s.delivery_date <= client.expiry_date)
          ));

      const weekMeals = await this.buildWeekMeals(selections);
      const todayDelivery = this.getTodayDelivery(weekMeals);

      // effectiveStartDate ya es siempre una fecha real de entrega elegida
      // en el calendario (ver pages/start-date) -- nunca cae en fin de
      // semana ni feriado, así que no hace falta correrla al lunes más
      // próximo como en el viejo modelo "5 días corridos".
      let startDateFormatted = '';
      if (isUpcoming && effectiveStartDate) {
        startDateFormatted = this.formatFullDate(new Date(effectiveStartDate + 'T00:00:00'));
      }

      const realToday = new Date().getDay();
      const showRenewal = !isUpcoming && !hasPendingRenewal && (realToday === 5 || daysLeft <= 2);

      // Texto del banner: "hoy"/"mañana" en vez de "0/1 days left" cuando
      // corresponde; genérico con el número el resto de los casos (incluido
      // el aviso de los viernes cuando quedan más de 2 días).
      let renewalSubText;
      if (daysLeft <= 0) renewalSubText = t('home_renewal_sub_today');
      else if (daysLeft === 1) renewalSubText = t('home_renewal_sub_tomorrow');
      else renewalSubText = t('home_renewal_sub', daysLeft);

      const planLabel = client.plan_name || '';

      let expiryFormatted = '';
      if (client.expiry_date) {
        const d = new Date(client.expiry_date);
        expiryFormatted = this.formatFullDate(d);
      }

      let planPrice = 0;
      if (client.plan_id) {
        const pd = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
        if (pd && pd.length > 0) planPrice = pd[0].price || 0;
      }

      this.setData({
        client,
        firstName,
        weekMeals,
        todayDelivery,
        showRenewal,
        hasPendingRenewal,
        daysLeft,
        planLabel,
        planPrice,
        expiryFormatted,
        isUpcoming,
        startDateFormatted,
        loading: false,
        lbl_hi: t('home_hi', firstName),
        lbl_first_delivery: t('home_first_delivery', startDateFormatted),
        lbl_renewal_sub: renewalSubText,
        lbl_renewal_pending_sub: t('home_renewal_pending_sub', pendingRenewalDateFormatted),
      });

    } catch (err) {
      console.error('Load client error:', err);
      this.setData({ loading: false });
    }
  },

  // "Hoy" es la fila cuyo `delivery_date` coincide con la fecha de hoy.
  // Filas con delivery_date NULL (legacy, sin fecha resoluble todavía) no
  // se pueden ubicar en el calendario y se omiten.
  async buildWeekMeals(selections) {
    const todayStr = toDateString(new Date());
    const sorted = selections
      .filter(s => s.slot === 1 && s.delivery_date)
      .slice()
      .sort((a, b) => (a.delivery_date < b.delivery_date ? -1 : 1));

    const allIds = [];
    sorted.forEach(s => {
      if (s.meals_json) s.meals_json.forEach(id => { if (id && !allIds.includes(id)) allIds.push(id); });
    });

    let mealMap = {};
    if (allIds.length > 0) {
      const meals = await app.supabase('GET', 'meal_library', null, `id=in.(${allIds.join(',')})`);
      (meals || []).forEach(m => { mealMap[m.id] = m; });
    }

    return sorted.map(row => {
      const mealIds = row.meals_json || [];
      // `key` combina id + posición: un cliente puede elegir la misma
      // comida más de una vez en el mismo día (2 porciones), así que el
      // nombre solo no alcanza como wx:key único en el wxml.
      const mealNames = mealIds.map((id, i) => {
        if (!mealMap[id]) return null;
        return { name: app.getMealName(mealMap[id]), key: `${id}_${i}` };
      }).filter(Boolean);
      const photo = mealIds.length > 0 && mealMap[mealIds[0]] ? mealMap[mealIds[0]].photo_url || '' : '';
      return {
        day: row.delivery_date,
        // Un cliente puede tener más de una entrega el mismo día (slots),
        // así que la fecha sola no alcanza como wx:key único.
        key: `${row.delivery_date}#${row.slot}`,
        dayShort: formatShortDate(row.delivery_date, _isZh ? 'zh' : 'en'),
        mealNames,
        time: row.delivery_time || '',
        isToday: row.delivery_date === todayStr,
        photo,
      };
    });
  },

  getTodayDelivery(weekMeals) {
    const todayMeals = weekMeals.find(m => m.isToday);
    if (!todayMeals || !todayMeals.mealNames || todayMeals.mealNames.length === 0) return null;
    return { day: todayMeals.day, time: todayMeals.time };
  },

  // Diferencia en días de calendario (medianoche a medianoche, hora local),
  // no en milisegundos -- `new Date(expiresAt)` sin 'T00:00:00' se parsea
  // como UTC, y mezclado con `new Date()` (local) el corte de "1 día antes"
  // podía atrasarse hasta 8hs (huso de Shanghai) cerca de la medianoche.
  getDaysLeft(expiresAt) {
    if (!expiresAt) return 999;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiresAt + 'T00:00:00');
    return Math.round((expiry - today) / 86400000);
  },

  // Formatea una fecha como "Monday, Aug 3" (EN) o "8月3日 周一" (ZH).
  formatFullDate(d) {
    if (_isZh) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
    }
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/edit-profile/index' });
  },

  goToMealSelect() {
    wx.showLoading({ title: t('loading') });
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/edit-meals/index' });
    }, 300);
  },

  goToRenewal() {
    wx.navigateTo({ url: '/pages/renewal/index' });
  },

  viewMenu() {
    app.openBrochure();
  },

  onShareAppMessage() {
    return {
      title: t('share_title_home'),
      path: '/pages/discovery/index',
      imageUrl: '/images/hero-meal-share.jpeg',
    };
  },

  onShareTimeline() {
    return {
      title: t('share_title_home'),
      imageUrl: '/images/hero-meal-share.jpeg',
    };
  },

});
