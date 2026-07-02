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
    snackOfDay: null,
    snackAdded: false,
    snackId: null,
    // Time — one per day
    selectedTime: '09:45',
    // Notes
    currentNotes: '',
    // All selections across days: { mon: { meal_ids, snack_id, time, notes }, ... }
    allSelections: {},
    isLastDay: false,
    canGoNext: false,
    dayConfirmed: false,
    lastSelectedPhoto: '',
    lastSelectedName: '',
    saucesById: {},
    currentSauces: {},
    sauceModal: { visible: false, mealId: null, options: [] },
    lbl_title: '',
    lbl_change_plan: '',
    lbl_kcal: '',
    lbl_select_sauce: '',
    lbl_add_snack: '',
    lbl_snack_added: '',
    lbl_delivery_time: '',
    lbl_tap_to_change: '',
    lbl_notes: '',
    lbl_notes_placeholder: '',
    lbl_continue: '',
    lbl_save_next: '',
    lbl_cancel: '',
  },

  async onLoad(options) {
    this.setData({
      lbl_title: t('meal_select_title'),
      lbl_change_plan: t('meal_select_change_plan'),
      lbl_kcal: t('meal_select_kcal'),
      lbl_select_sauce: t('meal_select_select_sauce'),
      lbl_add_snack: t('meal_select_add_snack'),
      lbl_snack_added: t('meal_select_snack_added'),
      lbl_delivery_time: t('meal_select_delivery_time'),
      lbl_tap_to_change: t('meal_select_tap_to_change'),
      lbl_notes: t('meal_select_notes'),
      lbl_notes_placeholder: t('meal_select_notes_placeholder'),
      lbl_continue: t('meal_select_continue'),
      lbl_save_next: t('meal_select_save_next'),
      lbl_meals_day: t('plans_meals_per_day'),
      lbl_cancel: t('payment_simulate_cancel'),
    });
    const fromRenewal = options.from === 'renewal' || wx.getStorageSync('flowContext') === 'renewal';
    const fromOrderSummary = options.from === 'order-summary';
    console.log('[meal-select] fromRenewal:', fromRenewal, 'options.from:', options.from, 'storage:', wx.getStorageSync('flowContext'));
    if (fromRenewal) wx.removeStorageSync('flowContext');
    const selectedPlan = app.getDisplayPlan(wx.getStorageSync('selectedPlan'));

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    const freshMeals = wx.getStorageSync('renewalFreshMeals');
    if (freshMeals) wx.removeStorageSync('renewalFreshMeals');

    let allSelections = freshMeals ? {} : (wx.getStorageSync('mealSelections') || {});
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
              snack_id: row.snack_id || null,
              time: row.delivery_time || '09:45',
              notes: row.note || '',
            };
          });
        }
      } catch (err) {
        console.error('Load existing selections error:', err);
      }
    }

    const startDateStr = wx.getStorageSync('startDate') || null;
    const days = DAYS.map(d => ({ ...d, done: false }));
    this.setData({ fromRenewal, fromOrderSummary, selectedPlan, days, allSelections, startDateStr });

    try {
      const saucesData = await app.supabase('GET', 'meal_library', null, 'item_type=eq.sauce');
      const saucesById = {};
      (saucesData || []).forEach(s => { saucesById[s.id] = s; });
      this.setData({ saucesById });
    } catch (err) {
      console.error('Load sauces error:', err);
    }

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

      let snackOfDay = null;
      let snackId = null;
      if (menu && menu.snack_id) {
        const snackData = await app.supabase('GET', 'meal_library', null, `id=eq.${menu.snack_id}`);
        if (snackData && snackData.length > 0) {
          snackOfDay = app.getMealName(snackData[0]);
          snackId = menu.snack_id;
        }
      }

      const dayIndex = DAYS.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === DAYS.length - 1;

      // Restore existing selections for this day
      const existing = this.data.allSelections[dayKey];
      const existingMealIds = existing ? existing.meal_ids : [];
      const existingTime = existing ? existing.time : '09:45';
      const existingNotes = existing ? existing.notes : '';
      const existingSnack = existing ? !!existing.snack_id : false;
      const existingSauces = (existing && existing.sauces) || {};

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

      const dayConfirmed = existingMealIds.length >= (this.data.selectedPlan ? this.data.selectedPlan.meals : 1);

      const days = this.data.days.map(d =>
        d.key === dayKey ? { ...d, done: dayConfirmed } : d
      );

      const { saucesById } = this.data;
      const updatedMeals = (meals || []).map(m => {
        const sauceIds = m.available_sauce_ids || [];
        const sauceOptions = sauceIds.map(id => {
          const s = saucesById[id];
          return { id, name: s ? app.getMealName(s) : id, name_zh: s ? (s.name_zh || '') : '' };
        });
        const candidateSauceId = existingSauces[m.id];
        const selectedSauceId = (candidateSauceId && sauceIds.includes(candidateSauceId)) ? candidateSauceId : null;
        const selectedSauceName = selectedSauceId && saucesById[selectedSauceId] ? app.getMealName(saucesById[selectedSauceId]) : '';
        return {
          ...m,
          displayName: app.getMealName(m),
          qty: existingMealIds.filter(id => id === m.id).length,
          sauceOptions,
          selectedSauceId,
          selectedSauceName,
        };
      });

      this.setData({
        loading: false,
        menuMeals: updatedMeals,
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        snackOfDay,
        snackId,
        snackAdded: existingSnack,
        isLastDay,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        selectedMealIds: existingMealIds,
        currentSauces: existingSauces,
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

  incrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedPlan, menuMeals, currentSauces } = this.data;
    const maxMeals = selectedPlan ? selectedPlan.meals : 1;

    if (selectedMealIds.length >= maxMeals) {
      wx.showToast({ title: t('meal_select_max_meals', maxMeals), icon: 'none' });
      return;
    }

    const newIds = [...selectedMealIds, meal.id];
    const updatedMeals = menuMeals.map(m => ({
      ...m,
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
    const { selectedMealIds, selectedPlan, menuMeals, currentSauces } = this.data;
    const maxMeals = selectedPlan ? selectedPlan.meals : 1;

    const idx = selectedMealIds.indexOf(meal.id);
    if (idx < 0) return;

    const newIds = [...selectedMealIds];
    newIds.splice(idx, 1);
    const updatedMeals = menuMeals.map(m => ({
      ...m,
      qty: m.id === meal.id ? Math.max((m.qty || 0) - 1, 0) : m.qty,
    }));
    const dayConfirmed = newIds.length >= maxMeals;

    const newSauces = { ...currentSauces };
    if (!newIds.includes(meal.id)) delete newSauces[meal.id];

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      currentSauces: newSauces,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
      dayConfirmed,
    }, () => this.persistCurrentDay());
  },

  openSaucePicker(e) {
    const mealId = e.currentTarget.dataset.mealId;
    const meal = this.data.menuMeals.find(m => m.id === mealId);
    if (!meal || !meal.sauceOptions || meal.sauceOptions.length === 0) return;
    this.setData({ sauceModal: { visible: true, mealId, options: meal.sauceOptions } });
  },

  closeSauceModal() {
    this.setData({ sauceModal: { visible: false, mealId: null, options: [] } });
  },

  pickSauce(e) {
    const { mealId, options } = this.data.sauceModal;
    const idx = e.currentTarget.dataset.idx;
    const sauce = options[idx];
    if (!sauce) return;
    const currentSauces = { ...this.data.currentSauces, [mealId]: sauce.id };
    const menuMeals = this.data.menuMeals.map(m =>
      m.id === mealId ? { ...m, selectedSauceId: sauce.id, selectedSauceName: app.getMealName(sauce) } : m
    );
    this.setData({ currentSauces, menuMeals, sauceModal: { visible: false, mealId: null, options: [] } }, () => this.persistCurrentDay());
  },

  onTimeChange(e) {
    this.setData({ selectedTime: e.detail.value }, () => this.persistCurrentDay());
  },

  onNotesInput(e) {
    this.setData({ currentNotes: e.detail.value }, () => this.persistCurrentDay());
  },

  toggleSnack() {
    this.setData({ snackAdded: !this.data.snackAdded }, () => this.persistCurrentDay());
  },

  // Guarda en memoria (allSelections) lo que haya en pantalla para el día
  // actual, sin pegarle a Supabase — así no se pierde nada al cambiar de
  // día sin tocar un botón explícito de "Save".
  persistCurrentDay() {
    const { selectedMealIds, selectedTime, currentNotes, snackAdded, snackId, currentDay, allSelections, days, currentSauces } = this.data;

    const updatedSelections = { ...allSelections };
    if (selectedMealIds.length === 0) {
      delete updatedSelections[currentDay];
    } else {
      updatedSelections[currentDay] = {
        meal_ids: selectedMealIds,
        snack_id: snackAdded ? snackId : null,
        time: selectedTime,
        notes: currentNotes,
        sauces: currentSauces,
      };
    }

    const maxMeals = this.data.selectedPlan ? this.data.selectedPlan.meals : 1;
    const dayDone = selectedMealIds.length >= maxMeals;
    const updatedDays = days.map(d => d.key === currentDay ? { ...d, done: dayDone } : d);

    this.setData({ allSelections: updatedSelections, days: updatedDays, canGoNext: dayDone });
  },

  saveAndNext() {
    const { selectedMealIds, selectedPlan } = this.data;

    if (selectedMealIds.length < selectedPlan.meals) {
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
      const incompleteDay = DAYS.find(d => {
        const sel = allSelections[d.key];
        return !sel || !sel.meal_ids || sel.meal_ids.length < selectedPlan.meals;
      });

      if (incompleteDay) {
        wx.showToast({ title: t('meal_select_incomplete_day', incompleteDay.label), icon: 'none' });
        return;
      }

      wx.setStorageSync('mealSelections', allSelections);
      if (fromOrderSummary) {
        wx.navigateBack();
      } else if (fromRenewal) {
        wx.navigateTo({ url: '/pages/order-summary/index?from=renewal' });
      } else {
        wx.navigateTo({ url: '/pages/register/index' });
      }
    } else {
      const dayIndex = DAYS.findIndex(d => d.key === currentDay);
      const nextDay = DAYS[dayIndex + 1].key;
      this.loadMenu(nextDay);
    }
  },

  goBack() {
    wx.navigateBack();
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
