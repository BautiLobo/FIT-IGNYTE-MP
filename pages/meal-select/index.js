// pages/meal-select/index.js
const app = getApp();

const DAYS = [
  { key: 'mon', label: 'Monday',    short: 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday',  short: 'Thu' },
  { key: 'fri', label: 'Friday',    short: 'Fri' },
];

Page({
  data: {
    loading: true,
    fromRenewal: false,
    fromOrderSummary: false,
    selectedPlan: null,
    days: [],
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
  },

  async onLoad(options) {
    const fromRenewal = options.from === 'renewal' || wx.getStorageSync('flowContext') === 'renewal';
    const fromOrderSummary = options.from === 'order-summary';
    console.log('[meal-select] fromRenewal:', fromRenewal, 'options.from:', options.from, 'storage:', wx.getStorageSync('flowContext'));
    if (fromRenewal) wx.removeStorageSync('flowContext');
    const selectedPlan = wx.getStorageSync('selectedPlan');

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

    const days = DAYS.map(d => ({ ...d, done: false }));
    this.setData({ fromRenewal, fromOrderSummary, selectedPlan, days, allSelections });
    await this.loadMenu('mon');
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], lastSelectedPhoto: '', lastSelectedName: '', dayConfirmed: false });

    try {
      const dayLabel = DAYS.find(d => d.key === dayKey)?.label || '';
      const planTier = this.data.selectedPlan ? this.data.selectedPlan.tier : null;

      const menuQuery = planTier
        ? `day=eq.${dayLabel}&tier=eq.${planTier}`
        : `day=eq.${dayLabel}`;
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
          snackOfDay = snackData[0].name;
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

      const updatedMeals = (meals || []).map(m => ({
        ...m,
        qty: existingMealIds.filter(id => id === m.id).length,
      }));

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
        lastSelectedPhoto,
        lastSelectedName,
        dayConfirmed,
        canGoNext: dayConfirmed,
        days,
      });

    } catch (err) {
      console.error('Load menu error:', err);
      this.setData({ loading: false });
      wx.showToast({ title: 'Failed to load menu', icon: 'none' });
    }
  },

  incrementMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedPlan, menuMeals } = this.data;
    const maxMeals = selectedPlan ? selectedPlan.meals : 1;

    if (selectedMealIds.length >= maxMeals) {
      wx.showToast({ title: `Max ${maxMeals} meal(s) for this plan`, icon: 'none' });
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
    const { selectedMealIds, selectedPlan, menuMeals } = this.data;
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

    this.setData({
      selectedMealIds: newIds,
      menuMeals: updatedMeals,
      lastSelectedPhoto: meal.photo_url || '',
      lastSelectedName: meal.name,
      dayConfirmed,
    }, () => this.persistCurrentDay());
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
    const { selectedMealIds, selectedTime, currentNotes, snackAdded, snackId, currentDay, allSelections, days } = this.data;

    const updatedSelections = { ...allSelections };
    if (selectedMealIds.length === 0) {
      delete updatedSelections[currentDay];
    } else {
      updatedSelections[currentDay] = {
        meal_ids: selectedMealIds,
        snack_id: snackAdded ? snackId : null,
        time: selectedTime,
        notes: currentNotes,
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
      wx.showToast({ title: `Select ${selectedPlan.meals} meal(s) first`, icon: 'none' });
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
        wx.showToast({ title: `Select your ${incompleteDay.label} meal(s) first`, icon: 'none' });
        return;
      }

      wx.setStorageSync('mealSelections', allSelections);
      if (fromOrderSummary) {
        wx.navigateBack();
      } else if (fromRenewal) {
        wx.navigateTo({ url: '/pages/start-date/index?from=renewal' });
      } else {
        wx.navigateTo({ url: '/pages/register/index' });
      }
    } else {
      const dayIndex = DAYS.findIndex(d => d.key === currentDay);
      const nextDay = DAYS[dayIndex + 1].key;
      this.loadMenu(nextDay);
    }
  },

  async saveMealSelections(clientId, allSelections) {
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const [key, label] of Object.entries(dayMap)) {
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      await app.supabase('POST', 'meal_selections', {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        snack_id: sel.snack_id,
        note: sel.notes || '',
      });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  contactUs() {
    wx.showModal({
      title: 'Contact us on WeChat',
      content: 'Search for: fitignyte_shanghai',
      showCancel: false,
      confirmText: 'OK',
    });
  },
});
