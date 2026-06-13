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
    fromHome: false,
    fromRenewal: false,
    selectedPlan: null,
    days: [],
    currentDay: 'mon',
    currentDayLabel: 'Monday',
    menuMeals: [],
    // Selected meals for current day (before confirming)
    selectedMealIds: [],   // array of meal IDs selected for this day
    selectedMealNames: [], // for display
    selectedMealPhotos: [],
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
    const fromHome = options.from === 'home';
    const fromRenewal = options.from === 'renewal';
    const selectedPlan = wx.getStorageSync('selectedPlan');

    if (!selectedPlan) {
      wx.navigateBack();
      return;
    }

    let allSelections = {};
    if (fromHome || fromRenewal) {
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
    this.setData({ fromHome, fromRenewal, selectedPlan, days, allSelections });
    await this.loadMenu('mon');
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], selectedMealNames: [], selectedMealPhotos: [], dayConfirmed: false });

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

      // Get meal names for existing selections
      let existingMealNames = [];
      let existingMealPhotos = [];
      if (existingMealIds.length > 0 && meals.length > 0) {
        existingMealIds.forEach(id => {
          const m = (meals || []).find(meal => meal.id === id);
          if (m) {
            existingMealNames.push(m.name);
            existingMealPhotos.push(m.photo_url || '');
          }
        });
      }

      const dayConfirmed = existingMealIds.length >= (this.data.selectedPlan ? this.data.selectedPlan.meals : 1);

      const days = this.data.days.map(d =>
        d.key === dayKey ? { ...d, done: dayConfirmed } : d
      );

      this.setData({
        loading: false,
        menuMeals: meals || [],
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        snackOfDay,
        snackId,
        snackAdded: existingSnack,
        isLastDay,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        selectedMealIds: existingMealIds,
        selectedMealNames: existingMealNames,
        selectedMealPhotos: existingMealPhotos,
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

  toggleMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedMealNames, selectedMealPhotos, selectedPlan, menuMeals } = this.data;
    const maxMeals = selectedPlan ? selectedPlan.meals : 1;

    const idx = selectedMealIds.indexOf(meal.id);
    let newIds = [...selectedMealIds];
    let newNames = [...selectedMealNames];
    let newPhotos = [...selectedMealPhotos];

    if (idx >= 0) {
      newIds.splice(idx, 1);
      newNames.splice(idx, 1);
      newPhotos.splice(idx, 1);
    } else if (newIds.length < maxMeals) {
      newIds.push(meal.id);
      newNames.push(meal.name);
      newPhotos.push(meal.photo_url || '');
    } else {
      wx.showToast({ title: `Max ${maxMeals} meal(s) for this plan`, icon: 'none' });
      return;
    }

    // Update menuMeals with selected flag
    const updatedMeals = menuMeals.map(m => ({
      ...m,
      selected: newIds.includes(m.id),
      selectedIndex: newIds.indexOf(m.id) >= 0 ? newIds.indexOf(m.id) + 1 : 0,
    }));

    const lastSelectedPhoto = newPhotos.length > 0 ? newPhotos[newPhotos.length - 1] : '';
    const lastSelectedName = newNames.length > 0 ? newNames[newNames.length - 1] : '';
    const dayConfirmed = newIds.length >= maxMeals;

    this.setData({
      selectedMealIds: newIds,
      selectedMealNames: newNames,
      selectedMealPhotos: newPhotos,
      menuMeals: updatedMeals,
      lastSelectedPhoto,
      lastSelectedName,
      dayConfirmed,
    });
  },

  onTimeChange(e) {
    this.setData({ selectedTime: e.detail.value });
  },

  onNotesInput(e) {
    this.setData({ currentNotes: e.detail.value });
  },

  toggleSnack() {
    this.setData({ snackAdded: !this.data.snackAdded });
  },

  confirmDay() {
    const { selectedMealIds, selectedMealNames, selectedTime, currentNotes, snackAdded, snackId, currentDay, allSelections, selectedPlan } = this.data;

    if (selectedMealIds.length < selectedPlan.meals) {
      wx.showToast({ title: `Select ${selectedPlan.meals} meal(s) first`, icon: 'none' });
      return;
    }

    const updatedSelections = {
      ...allSelections,
      [currentDay]: {
        meal_ids: selectedMealIds,
        snack_id: snackAdded ? snackId : null,
        time: selectedTime,
        notes: currentNotes,
      }
    };

    const days = this.data.days.map(d =>
      d.key === currentDay ? { ...d, done: true } : d
    );

    this.setData({ allSelections: updatedSelections, days, canGoNext: true });
    wx.showToast({ title: `${this.data.currentDayLabel} saved`, icon: 'none' });
  },

  switchDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.currentDay) return;
    this.loadMenu(day);
  },

  async goNext() {
    if (!this.data.canGoNext) return;
    const { currentDay, isLastDay, allSelections, fromHome, fromRenewal } = this.data;

    if (isLastDay) {
      if (fromHome) {
        const clientId = wx.getStorageSync('clientId');
        try {
          // Save each day to meal_selections table
          await this.saveMealSelections(clientId, allSelections);
          wx.showToast({ title: 'Meals updated', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {
          console.error('Save error:', err);
          wx.showToast({ title: 'Failed to save', icon: 'none' });
        }
      } else if (fromRenewal) {
        wx.setStorageSync('mealSelections', allSelections);
        wx.navigateTo({ url: '/pages/payment/index?from=renewal' });
      } else {
        wx.setStorageSync('mealSelections', allSelections);
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
