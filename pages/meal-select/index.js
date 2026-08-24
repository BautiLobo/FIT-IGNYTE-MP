// pages/meal-select/index.js
const app = getApp();
const t = require('../../i18n/index');

const _isZh = (wx.getAppBaseInfo().language || '').startsWith('zh');
const DAYS = [
  { key: 'mon', label: 'Monday',    short: _isZh ? '周一' : 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: _isZh ? '周二' : 'Tue' },
  { key: 'wed', label: 'Wednesday', short: _isZh ? '周三' : 'Wed' },
  { key: 'thu', label: 'Thursday',  short: _isZh ? '周四' : 'Thu' },
  { key: 'fri', label: 'Friday',    short: _isZh ? '周五' : 'Fri' },
];

Page({
  data: {
    loading: true,
    fromRenewal: false,
    fromOrderSummary: false,
    selectedPlan: null,
    days: [],
    rotationAnchor: null,
    rotationOrder: [1, 2, 3, 4],
    startDateStr: null,
    currentDay: 'mon',
    currentDayLabel: 'Monday',
    menuMeals: [],
    // Selected meals for current day (before confirming)
    selectedMealIds: [],   // array of meal IDs selected for this day (can repeat)
    // Snack
    // Time — one per day
    selectedTime: '10:00',
    // Horario "default" propagado desde el lunes a los días que el usuario
    // todavía no cambió manualmente.
    defaultTime: '10:00',
    // Días donde el usuario ya eligió un horario propio (no se pisan
    // cuando el lunes cambia).
    timeOverridden: {},
    // Notes
    currentNotes: '',
    // All selections across days: { mon: { meal_ids, time, notes }, ... }
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

    const freshMeals = wx.getStorageSync('renewalFreshMeals');
    if (freshMeals) wx.removeStorageSync('renewalFreshMeals');

    // Only restore saved selections when returning from order-summary to edit.
    // Fresh signup and renewal both start empty (renewal then populates from DB).
    let allSelections = fromOrderSummary ? (wx.getStorageSync('mealSelections') || {}) : {};
    if (fromRenewal && !freshMeals) {
      const clientId = wx.getStorageSync('clientId');
      try {
        const data = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc,slot.asc`);
        if (data && data.length > 0) {
          const dayKeyMap = { 'Monday': 'mon', 'Tuesday': 'tue', 'Wednesday': 'wed', 'Thursday': 'thu', 'Friday': 'fri' };
          data.forEach(row => {
            const dayKey = dayKeyMap[row.day];
            if (!dayKey) return;
            allSelections[dayKey] = {
              meal_ids: row.meals_json || [],
              time: row.delivery_time || '10:00',
              notes: row.note || '',
            };
          });
        }
      } catch (err) {
        console.error('Load existing selections error:', err);
      }
    }

    // Si ya había selecciones previas (volviendo a editar), el horario del
    // lunes pasa a ser el default, y los días con un horario distinto al
    // del lunes quedan marcados como "override" para no pisarlos.
    const defaultTime = (allSelections.mon && allSelections.mon.time) || '10:00';
    const timeOverridden = {};
    DAYS.forEach(d => {
      if (d.key !== 'mon' && allSelections[d.key] && allSelections[d.key].time && allSelections[d.key].time !== defaultTime) {
        timeOverridden[d.key] = true;
      }
    });

    const startDateStr = wx.getStorageSync('startDate') || null;
    const days = DAYS.map(d => Object.assign({}, d, { done: false }));
    this.setData({ fromRenewal, fromOrderSummary, selectedPlan, days, allSelections, startDateStr, defaultTime, timeOverridden });

    try {
      const { anchor, order } = await app.getMenuRotation();
      this.setData({ rotationAnchor: anchor, rotationOrder: order });
    } catch (err) {
      console.error('Load menu rotation error:', err);
    }

    await this.loadMenu('mon');
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], lastSelectedPhoto: '', lastSelectedName: '', dayConfirmed: false });

    try {
      const dayLabel = DAYS.find(d => d.key === dayKey)?.label || '';
      const planTier = this.data.selectedPlan ? this.data.selectedPlan.tier : null;
      const { rotationAnchor, rotationOrder, startDateStr } = this.data;
      const weekIndex = app.getWeekIndexForDay(dayKey, rotationAnchor, rotationOrder, startDateStr);

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

      const dayIndex = DAYS.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === DAYS.length - 1;

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

      const days = this.data.days.map(d =>
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
        days,
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
    const { currentDay, allSelections, timeOverridden } = this.data;

    let updatedSelections = allSelections;
    let defaultTime = this.data.defaultTime;
    let updatedOverrides = timeOverridden;

    if (currentDay === 'mon') {
      // El lunes define el horario "default": se propaga a los demás días
      // que el usuario todavía no cambió a mano (esos quedan como están).
      defaultTime = newTime;
      updatedSelections = Object.assign({}, allSelections);
      DAYS.forEach(d => {
        if (d.key !== 'mon' && !timeOverridden[d.key] && updatedSelections[d.key]) {
          updatedSelections[d.key] = Object.assign({}, updatedSelections[d.key], { time: newTime });
        }
      });
    } else {
      // Cambiar el horario de otro día lo marca como override: de ahí en
      // más, cambiar el lunes ya no le pisa el horario a este día.
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
    const { currentDay, isLastDay, allSelections, fromRenewal, fromOrderSummary, selectedPlan } = this.data;

    if (isLastDay) {
      const requiredMeals = Math.max((selectedPlan && selectedPlan.meals) || 1, 1);
      const incompleteDay = DAYS.find(d => {
        const sel = allSelections[d.key];
        return !sel || !sel.meal_ids || sel.meal_ids.length < requiredMeals;
      });
      if (incompleteDay) {
        wx.showToast({ title: t('meal_select_incomplete_day', incompleteDay.label), icon: 'none' });
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
      const dayIndex = DAYS.findIndex(d => d.key === currentDay);
      const nextDay = DAYS[dayIndex + 1].key;
      this.loadMenu(nextDay);
    }
  },

  setCutlery(e) {
    this.setData({ needsCutlery: e.currentTarget.dataset.value === true });
  },

  goBack() {
    wx.navigateBack();
  },

  changePlan() {
    // La pila es .../plans → start-date → meal-select: 2 saltos atrás
    // devuelve directo a plans, salteando start-date.
    wx.navigateBack({
      delta: 2,
      fail: () => wx.navigateBack(),
    });
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
