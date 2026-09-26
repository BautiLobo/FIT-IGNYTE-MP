// pages/meal-select/index.js
const app = getApp();
const t = require('../../i18n/index');
const { formatShortDate, formatDateParts } = require('../../utils/date-format');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// La tabla `menu` (catálogo de rotación) sigue siendo por día de semana --
// esto solo traduce una fecha real a ese nombre para poder consultarla.
function weekdayLabelForDate(dateStr) {
  return WEEKDAY_LABELS[new Date(dateStr + 'T00:00:00').getDay()];
}

Page({
  data: {
    loading: true,
    fromRenewal: false,
    fromOrderSummary: false,
    selectedPlan: null,
    days: [],
    rotationAnchor: null,
    rotationOrder: [1, 2, 3, 4],
    currentDay: '',
    currentDayLabel: '',
    menuMeals: [],
    // Selected meals for current day (before confirming)
    selectedMealIds: [],   // array of meal IDs selected for this day (can repeat)
    // Time — one per day
    selectedTime: '10:15',
    // Horario "default" propagado desde el primer día elegido a los días
    // que el usuario todavía no cambió manualmente.
    defaultTime: '10:15',
    // Días donde el usuario ya eligió un horario propio (no se pisan
    // cuando el primer día cambia).
    timeOverridden: {},
    // Notes
    currentNotes: '',
    // All selections across days: { '2026-09-19': { meal_ids, time, notes }, ... }
    allSelections: {},
    isLastDay: false,
    canGoNext: false,
    dayConfirmed: false,
    needsCutlery: false,
    lastSelectedPhoto: '',
    lastSelectedName: '',
    lbl_title: '',
    lbl_change_plan: '',
    lbl_kcal: '',
    lbl_delivery_time: '',
    lbl_tap_to_change: '',
    lbl_notes: '',
    lbl_notes_placeholder: '',
    lbl_continue: '',
    lbl_save_next: '',
    lbl_cancel: '',
    lbl_cutlery_title: '',
    lbl_cutlery_yes: '',
    lbl_cutlery_no: '',
    lbl_protein: '',
    lbl_carbs: '',
    lbl_fat: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('meal_select_title'),
      lbl_change_plan: t('meal_select_change_plan'),
      lbl_kcal: t('meal_select_kcal'),
      lbl_delivery_time: t('meal_select_delivery_time'),
      lbl_tap_to_change: t('meal_select_tap_to_change'),
      lbl_notes: t('meal_select_notes'),
      lbl_notes_placeholder: t('meal_select_notes_placeholder'),
      lbl_continue: t('meal_select_continue'),
      lbl_save_next: t('meal_select_save_next'),
      lbl_meals_day: t('plans_meals_per_day'),
      lbl_cutlery_title: t('meal_select_cutlery_title'),
      lbl_cutlery_yes: t('meal_select_cutlery_yes'),
      lbl_protein: t('meal_select_protein'),
      lbl_carbs: t('meal_select_carbs'),
      lbl_fat: t('meal_select_fat'),
      lbl_cutlery_no: t('meal_select_cutlery_no'),
      lbl_cancel: t('payment_simulate_cancel'),
    });
    const fromRenewal = options.from === 'renewal' || wx.getStorageSync('flowContext') === 'renewal';
    const fromOrderSummary = options.from === 'order-summary';
    if (fromRenewal) wx.removeStorageSync('flowContext');
    const selectedPlan = app.getDisplayPlan(wx.getStorageSync('selectedPlan'));

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    // Las 5 fechas reales elegidas en el calendario que precede a esta
    // página (pages/start-date) -- alta nueva y renovación pasan siempre
    // por ahí antes de llegar acá.
    const selectedDates = (wx.getStorageSync('selectedDates') || []).slice().sort();
    if (selectedDates.length === 0) { wx.navigateBack(); return; }
    const days = selectedDates.map((dateStr) => {
      const parts = formatDateParts(dateStr, _isZh ? 'zh' : 'en');
      return {
        key: dateStr,
        label: weekdayLabelForDate(dateStr),
        short: formatShortDate(dateStr, _isZh ? 'zh' : 'en'),
        shortDate: parts.date,
        shortWeekday: parts.weekday,
        done: false,
      };
    });
    const firstDayKey = days[0].key;

    // Alta nueva y renovación arrancan SIEMPRE en blanco. Lo único que se
    // restaura es volver desde el resumen a corregir lo que se acaba de
    // elegir en este mismo flujo.
    //
    // Acá vivía un precargado de las comidas del ciclo anterior (traídas de
    // meal_selections y copiadas por posición) que corría cuando el flag
    // `renewalFreshMeals` no estaba. Ese flag se consumía en la primera
    // lectura, así que bastaba volver atrás y re-entrar para que la
    // renovación se precargara con el ciclo viejo -- incluso con un plan
    // nuevo de otra cantidad de comidas, porque ningún chequeo comparaba
    // una cosa con la otra. Ver el comentario de startRenewal() en
    // renewal/index.js.
    const allSelections = fromOrderSummary ? (wx.getStorageSync('mealSelections') || {}) : {};

    // Si ya había selecciones previas (volviendo a editar), el horario del
    // primer día pasa a ser el default, y los días con un horario distinto
    // quedan marcados como "override" para no pisarlos.
    const defaultTime = (allSelections[firstDayKey] && allSelections[firstDayKey].time) || '10:15';
    const timeOverridden = {};
    days.forEach(d => {
      if (d.key !== firstDayKey && allSelections[d.key] && allSelections[d.key].time && allSelections[d.key].time !== defaultTime) {
        timeOverridden[d.key] = true;
      }
    });

    this.setData({ fromRenewal, fromOrderSummary, selectedPlan, days, allSelections, defaultTime, timeOverridden });

    try {
      const { anchor, order } = await app.getMenuRotation();
      this.setData({ rotationAnchor: anchor, rotationOrder: order });
    } catch (err) {
      console.error('Load menu rotation error:', err);
    }

    await this.loadMenu(firstDayKey);
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], lastSelectedPhoto: '', lastSelectedName: '', dayConfirmed: false });

    try {
      const { days } = this.data;
      const dayLabel = weekdayLabelForDate(dayKey);
      const planTier = this.data.selectedPlan ? this.data.selectedPlan.tier : null;
      const { rotationAnchor, rotationOrder } = this.data;
      const weekIndex = app.getWeekIndexForDay(dayKey, rotationAnchor, rotationOrder);

      const menuQuery = planTier
        ? `day=eq.${dayLabel}&tier=eq.${planTier}&week_index=eq.${weekIndex}`
        : `day=eq.${dayLabel}&week_index=eq.${weekIndex}`;
      const menuData = await app.supabase('GET', 'menu', null, menuQuery);
      const menu = menuData && menuData.length > 0 ? menuData[0] : null;

      let meals = [];
      if (menu && menu.meals_json && menu.meals_json.length > 0) {
        const ids = menu.meals_json.filter(Boolean);
        meals = await app.supabase('GET', 'meal_library', null, `id=in.(${ids.join(',')})`);
      }

      const dayIndex = days.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === days.length - 1;

      // Restore existing selections for this day
      const existing = this.data.allSelections[dayKey];
      const existingMealIds = existing ? existing.meal_ids : [];
      const existingTime = existing ? existing.time : this.data.defaultTime;
      const existingNotes = existing ? existing.notes : '';
      // Last selected meal photo/name for the preview
      let lastSelectedPhoto = '';
      let lastSelectedName = '';
      if (existingMealIds.length > 0 && meals.length > 0) {
        const lastId = existingMealIds[existingMealIds.length - 1];
        const m = (meals || []).find(meal => meal.id === lastId);
        if (m) {
          lastSelectedPhoto = m.photo_url || '';
          lastSelectedName = m.name;
        }
      }

      const maxMeals = Math.max((this.data.selectedPlan && this.data.selectedPlan.meals) || 1, 1);
      const dayConfirmed = existingMealIds.length >= maxMeals;

      const updatedDays = days.map(d =>
        d.key === dayKey ? Object.assign({}, d, { done: dayConfirmed }) : d
      );

      const updatedMeals = (meals || []).map(m => Object.assign({}, m, {
        displayName: app.getMealName(m),
        qty: existingMealIds.filter(id => id === m.id).length,
      }));

      this.setData({
        loading: false,
        menuMeals: updatedMeals,
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        isLastDay,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        selectedMealIds: existingMealIds,
        lastSelectedPhoto,
        lastSelectedName,
        dayConfirmed,
        canGoNext: dayConfirmed,
        days: updatedDays,
      });

    } catch (err) {
      console.error('Load menu error:', err);
      this.setData({ loading: false });
      wx.showToast({ title: t('meal_select_failed'), icon: 'none' });
    }
  },

  previewMeal(e) {
    // Tap en la fila: muestra la foto grande arriba, sin sumar cantidad.
    const meal = e.currentTarget.dataset.meal;
    this.setData({
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
    });
  },

  incrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedPlan, menuMeals } = this.data;
    const maxMeals = Math.max((selectedPlan && selectedPlan.meals) || 1, 1);

    if (selectedMealIds.length >= maxMeals) {
      wx.showToast({ title: t('meal_select_max_meals', maxMeals), icon: 'none' });
      return;
    }

    const newIds = selectedMealIds.concat([meal.id]);
    const updatedMeals = menuMeals.map(m => Object.assign({}, m, {
      qty: m.id === meal.id ? (m.qty || 0) + 1 : m.qty,
    }));
    const dayConfirmed = newIds.length >= maxMeals;

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
      dayConfirmed,
    }, () => this.persistCurrentDay());
  },

  decrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedPlan, menuMeals } = this.data;
    const maxMeals = Math.max((selectedPlan && selectedPlan.meals) || 1, 1);

    const idx = selectedMealIds.indexOf(meal.id);
    if (idx < 0) return;

    const newIds = selectedMealIds.slice();
    newIds.splice(idx, 1);
    const updatedMeals = menuMeals.map(m => Object.assign({}, m, {
      qty: m.id === meal.id ? Math.max((m.qty || 0) - 1, 0) : m.qty,
    }));
    const dayConfirmed = newIds.length >= maxMeals;

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
      dayConfirmed,
    }, () => this.persistCurrentDay());
  },

  onTimeChange(e) {
    const newTime = e.detail.value;
    const { currentDay, allSelections, timeOverridden, days } = this.data;
    const firstDayKey = days[0].key;

    let updatedSelections = allSelections;
    let defaultTime = this.data.defaultTime;
    let updatedOverrides = timeOverridden;

    if (currentDay === firstDayKey) {
      // El primer día elegido define el horario "default": se propaga a
      // los demás días que el usuario todavía no cambió a mano (esos
      // quedan como están).
      defaultTime = newTime;
      updatedSelections = Object.assign({}, allSelections);
      days.forEach(d => {
        if (d.key !== firstDayKey && !timeOverridden[d.key] && updatedSelections[d.key]) {
          updatedSelections[d.key] = Object.assign({}, updatedSelections[d.key], { time: newTime });
        }
      });
    } else {
      // Cambiar el horario de otro día lo marca como override: de ahí en
      // más, cambiar el primer día ya no le pisa el horario a este día.
      updatedOverrides = Object.assign({}, timeOverridden);
      updatedOverrides[currentDay] = true;
    }

    this.setData({
      selectedTime: newTime,
      defaultTime,
      timeOverridden: updatedOverrides,
      allSelections: updatedSelections,
    }, () => this.persistCurrentDay());
  },

  onNotesInput(e) {
    this.setData({ currentNotes: e.detail.value }, () => this.persistCurrentDay());
  },

  persistCurrentDay() {
    const { selectedMealIds, selectedTime, currentNotes, currentDay, allSelections, days } = this.data;

    const updatedSelections = Object.assign({}, allSelections);
    if (selectedMealIds.length === 0) {
      delete updatedSelections[currentDay];
    } else {
      updatedSelections[currentDay] = {
        meal_ids: selectedMealIds,
        time: selectedTime,
        notes: currentNotes,
      };
    }

    const maxMeals = Math.max((this.data.selectedPlan && this.data.selectedPlan.meals) || 1, 1);
    const dayDone = selectedMealIds.length >= maxMeals;
    const updatedDays = days.map(d => d.key === currentDay ? Object.assign({}, d, { done: dayDone }) : d);

    this.setData({ allSelections: updatedSelections, days: updatedDays, canGoNext: dayDone });
  },

  saveAndNext() {
    const { selectedMealIds, selectedPlan } = this.data;
    const maxMeals = Math.max((selectedPlan && selectedPlan.meals) || 1, 1);

    if (selectedMealIds.length < maxMeals) {
      wx.showToast({ title: t('meal_select_select_first', selectedPlan.meals), icon: 'none' });
      return;
    }

    this.persistCurrentDay();
    this.goNext();
  },

  switchDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.currentDay) return;
    this.persistCurrentDay();
    this.loadMenu(day);
  },

  async goNext() {
    if (!this.data.canGoNext) return;
    const { currentDay, isLastDay, allSelections, fromRenewal, fromOrderSummary, selectedPlan, days } = this.data;

    if (isLastDay) {
      const requiredMeals = Math.max((selectedPlan && selectedPlan.meals) || 1, 1);
      const incompleteDay = days.find(d => {
        const sel = allSelections[d.key];
        return !sel || !sel.meal_ids || sel.meal_ids.length < requiredMeals;
      });
      if (incompleteDay) {
        wx.showToast({ title: t('meal_select_incomplete_day', incompleteDay.short), icon: 'none' });
        return;
      }

      wx.setStorageSync('mealSelections', allSelections);
      wx.setStorageSync('cutleryNeeded', this.data.needsCutlery === true);
      // Flag de un solo uso (ver payment.js): dice si llegamos acá porque
      // el start_date había quedado vencido. Se lee una sola vez, abajo, y
      // se limpia siempre para no dejarlo pisando un flujo futuro distinto.
      const dateResync = wx.getStorageSync('dateResync');
      wx.removeStorageSync('dateResync');
      if (fromOrderSummary) {
        wx.navigateBack();
      } else if (fromRenewal) {
        wx.navigateTo({ url: '/pages/order-summary/index?from=renewal' });
      } else if (dateResync) {
        // Alta nueva ya aprobada, re-eligiendo fecha/comidas -- la orden y
        // el cliente ya existen, así que saltamos register.js (los datos
        // personales no cambiaron) directo a order-summary a revisar y pagar.
        wx.navigateTo({ url: '/pages/order-summary/index?from=repay' });
      } else {
        wx.navigateTo({ url: '/pages/register/index' });
      }
    } else {
      const dayIndex = days.findIndex(d => d.key === currentDay);
      const nextDay = days[dayIndex + 1].key;
      this.loadMenu(nextDay);
    }
  },

  setCutlery(e) {
    this.setData({ needsCutlery: e.currentTarget.dataset.value === true });
  },

  goBack() {
    wx.navigateBack();
  },

  // Antes esto asumía que SIEMPRE se llega por plans → start-date →
  // meal-select (exactamente 2 pantallas atrás, navigateBack delta:2), y
  // solo dejaba cambiar la cantidad de comidas DENTRO del mismo tier (nunca
  // volvía hasta tiers.js). Dejó de ser cierto en cuanto meal-select
  // empezó a alcanzarse por otros caminos con menos niveles de por medio
  // -- por ejemplo pagar tarde (payment.js hace redirectTo a start-date, no
  // navigateTo, así que no queda en la pila) o una renovación. Con
  // delta:2 en esos casos la pila no tenía 2 niveles para volver, y WeChat
  // se quedaba corto: terminaba en start-date en vez de en plans.
  //
  // Primer intento: mandar siempre a tiers.js con redirectTo. Eso arregló
  // el caso "pagar tarde" pero rompió el de renovación -- redirectTo solo
  // reemplaza la pantalla actual (meal-select), no limpia lo que quedó
  // debajo (tiers → plans → start-date, la instancia VIEJA, de antes de
  // cambiar de plan). Quedaba una tiers.js nueva arriba de esa pila vieja
  // sin tocar, y "atrás" desde ahí caía en el start-date.js enterrado en
  // vez de en renewal.js.
  //
  // Ahora se usa getCurrentPages() para mirar la pila real en vez de
  // asumir ninguna profundidad fija: si ya hay una tiers.js más abajo (alta
  // nueva o renovación normal), se vuelve a ESA con navigateBack -- mismo
  // "atrás" de siempre, sin duplicar pantallas. Si no hay ninguna (pagar
  // tarde: payment.js llegó a start-date con redirectTo, tiers.js nunca
  // estuvo en la pila), se despilan las pantallas de este mismo sub-flujo
  // que sí haya y se entra a tiers.js de cero recién ahí.
  changePlan() {
    const { fromRenewal } = this.data;
    if (fromRenewal) wx.setStorageSync('flowContext', 'renewal');

    const FUNNEL_ROUTES = ['pages/meal-select/index', 'pages/start-date/index', 'pages/plans/index', 'pages/tiers/index'];
    const pages = getCurrentPages();
    let tiersIndex = -1;
    for (let i = pages.length - 1; i >= 0; i--) {
      if (FUNNEL_ROUTES.indexOf(pages[i].route) === -1) break;
      if (pages[i].route === 'pages/tiers/index') tiersIndex = i;
    }

    if (tiersIndex !== -1) {
      wx.navigateBack({ delta: (pages.length - 1) - tiersIndex });
      return;
    }

    // No hay ningún tiers.js en la pila para volver con navigateBack (pagar
    // tarde: payment.js llegó acá con reLaunch + redirectTo, nunca hubo
    // tiers.js de por medio). Antes esto hacía navigateBack({delta:
    // popCount, success/fail: entrar a tiers}) para despilar lo que sí
    // hubiera de este sub-flujo antes de entrar -- pero wx.navigateBack NO
    // siempre dispara success/fail (sobre todo con delta mayor a la
    // cantidad de páginas reales, que es exactamente este caso: pila de 2
    // por pagar tarde), así que "entrar a tiers" nunca llegaba a correr y
    // el cliente quedaba varado en start-date. reLaunch no depende de
    // ningún callback de navegación: cierra TODA la pila actual de una,
    // así que no hace falta popCount para despilar nada antes.
    wx.reLaunch({ url: fromRenewal ? '/pages/tiers/index?from=renewal' : '/pages/tiers/index' });
  },

  contactUs() {
    wx.showModal({
      title: t('payment_contact_title'),
      content: t('payment_contact_content'),
      showCancel: false,
      confirmText: 'OK',
    });
  },
});
