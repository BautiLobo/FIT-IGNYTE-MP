// pages/edit-meals/index.js
const app = getApp();

const DAYS = [
  { key: 'mon', label: 'Monday',    short: 'Mon' },
  { key: 'tue', label: 'Tuesday',   short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday',  short: 'Thu' },
  { key: 'fri', label: 'Friday',    short: 'Fri' },
];

const DAY_KEY_MAP = { 'Monday': 'mon', 'Tuesday': 'tue', 'Wednesday': 'wed', 'Thursday': 'thu', 'Friday': 'fri' };

Page({
  data: {
    loading: true,
    plan: null,
    clientId: null,
    fromRenewal: false,
    days: [],
    currentDay: 'mon',
    currentDayLabel: 'Monday',
    menuMeals: [],
    selectedMealIds: [],
    selectedMealNames: [],
    selectedMealPhotos: [],
    snackOfDay: null,
    snackAdded: false,
    snackId: null,
    selectedTime: '09:45',
    currentNotes: '',
    allSelections: {},
    isLastDay: false,
    lastSelectedPhoto: '',
    lastSelectedName: '',
  },

  async onLoad(options) {
    const clientId = wx.getStorageSync('clientId');
    if (!clientId) { wx.navigateBack(); return; }
    const fromRenewal = options.from === 'renewal';
    this.setData({ fromRenewal });

    try {
      // Load client + plan
      const clientData = await app.supabase('GET', 'clients', null, `id=eq.${clientId}`);
      if (!clientData || clientData.length === 0) { wx.navigateBack(); return; }
      const client = clientData[0];

      const planData = await app.supabase('GET', 'plans', null, `id=eq.${client.plan_id}`);
      const plan = planData && planData.length > 0 ? planData[0] : null;
      if (!plan) { wx.navigateBack(); return; }

      // Load existing meal selections
      const selectionsData = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&order=day.asc`);
      const allSelections = {};
      (selectionsData || []).forEach(row => {
        const key = DAY_KEY_MAP[row.day];
        if (!key) return;
        allSelections[key] = {
          meal_ids: row.meals_json || [],
          snack_id: row.snack_id || null,
          time: row.delivery_time || '09:45',
          notes: row.note || '',
        };
      });

      const days = DAYS.map(d => ({
        ...d,
        done: !!(allSelections[d.key] && allSelections[d.key].meal_ids.length >= plan.meals),
      }));

      this.setData({ clientId, plan, allSelections, days });
      await this.loadMenu('mon');

    } catch (err) {
      console.error('edit-meals onLoad error:', err);
      wx.navigateBack();
    }
  },

  async loadMenu(dayKey) {
    this.setData({ loading: true, selectedMealIds: [], selectedMealNames: [], selectedMealPhotos: [] });

    try {
      const { plan, allSelections } = this.data;
      const dayLabel = DAYS.find(d => d.key === dayKey)?.label || '';

      const menuData = await app.supabase('GET', 'menu', null, `day=eq.${dayLabel}&tier=eq.${plan.tier}`);
      const menu = menuData && menuData.length > 0 ? menuData[0] : null;

      let meals = [];
      if (menu && menu.meals_json && menu.meals_json.length > 0) {
        const ids = menu.meals_json.filter(Boolean);
        meals = await app.supabase('GET', 'meal_library', null, `id=in.(${ids.join(',')})`);
      }

      let snackOfDay = null, snackId = null;
      if (menu && menu.snack_id) {
        const snackData = await app.supabase('GET', 'meal_library', null, `id=eq.${menu.snack_id}`);
        if (snackData && snackData.length > 0) {
          snackOfDay = snackData[0].name;
          snackId = menu.snack_id;
        }
      }

      // Restore existing selections
      const existing = allSelections[dayKey];
      const existingMealIds = existing ? existing.meal_ids : [];
      const existingTime = existing ? existing.time : '09:45';
      const existingNotes = existing ? existing.notes : '';
      const existingSnack = existing ? !!existing.snack_id : false;

      let existingMealNames = [], existingMealPhotos = [];
      existingMealIds.forEach(id => {
        const m = (meals || []).find(meal => meal.id === id);
        if (m) { existingMealNames.push(m.name); existingMealPhotos.push(m.photo_url || ''); }
      });

      const updatedMeals = (meals || []).map(m => ({
        ...m,
        selected: existingMealIds.includes(m.id),
        selectedIndex: existingMealIds.indexOf(m.id) >= 0 ? existingMealIds.indexOf(m.id) + 1 : 0,
      }));

      const dayIndex = DAYS.findIndex(d => d.key === dayKey);
      const isLastDay = dayIndex === DAYS.length - 1;

      this.setData({
        loading: false,
        currentDay: dayKey,
        currentDayLabel: dayLabel,
        menuMeals: updatedMeals,
        snackOfDay, snackId,
        snackAdded: existingSnack,
        selectedMealIds: existingMealIds,
        selectedMealNames: existingMealNames,
        selectedMealPhotos: existingMealPhotos,
        selectedTime: existingTime,
        currentNotes: existingNotes,
        isLastDay,
        lastSelectedPhoto: existingMealPhotos[existingMealPhotos.length - 1] || '',
        lastSelectedName: existingMealNames[existingMealNames.length - 1] || '',
      });

    } catch (err) {
      console.error('loadMenu error:', err);
      this.setData({ loading: false });
    }
  },

  toggleMeal(e) {
    const meal = e.currentTarget.dataset.meal;
    const { selectedMealIds, selectedMealNames, selectedMealPhotos, plan, menuMeals } = this.data;
    const maxMeals = plan.meals;
    const idx = selectedMealIds.indexOf(meal.id);
    let newIds = [...selectedMealIds];
    let newNames = [...selectedMealNames];
    let newPhotos = [...selectedMealPhotos];

    if (idx >= 0) {
      newIds.splice(idx, 1); newNames.splice(idx, 1); newPhotos.splice(idx, 1);
    } else if (newIds.length < maxMeals) {
      newIds.push(meal.id); newNames.push(meal.name); newPhotos.push(meal.photo_url || '');
    } else {
      wx.showToast({ title: `Max ${maxMeals} meal(s)`, icon: 'none' }); return;
    }

    const updatedMeals = menuMeals.map(m => ({
      ...m,
      selected: newIds.includes(m.id),
      selectedIndex: newIds.indexOf(m.id) >= 0 ? newIds.indexOf(m.id) + 1 : 0,
    }));

    this.setData({
      selectedMealIds: newIds,
      selectedMealNames: newNames,
      selectedMealPhotos: newPhotos,
      menuMeals: updatedMeals,
      lastSelectedPhoto: newPhotos[newPhotos.length - 1] || '',
      lastSelectedName: newNames[newNames.length - 1] || '',
    });
  },

  onTimeChange(e) { this.setData({ selectedTime: e.detail.value }); },
  onNotesInput(e) { this.setData({ currentNotes: e.detail.value }); },
  toggleSnack() { this.setData({ snackAdded: !this.data.snackAdded }); },
  switchDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.currentDay) return;
    this.loadMenu(day);
  },

  saveAndNext() {
    const { selectedMealIds, selectedTime, currentNotes, snackAdded, snackId, currentDay, allSelections, plan } = this.data;

    if (selectedMealIds.length < plan.meals) {
      wx.showToast({ title: `Select ${plan.meals} meal(s) first`, icon: 'none' }); return;
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

    const days = this.data.days.map(d => d.key === currentDay ? { ...d, done: true } : d);
    this.setData({ allSelections: updatedSelections, days }, () => {
      this.goNext();
    });
  },

  async goNext() {
    const { currentDay, isLastDay, allSelections, clientId } = this.data;

    if (isLastDay) {
      wx.showLoading({ title: 'Saving...' });
      try {
        await this.saveMealSelections(clientId, allSelections);
        wx.hideLoading();
        wx.showToast({ title: 'Meals updated!', icon: 'success' });
        const dest = this.data.fromRenewal
          ? '/pages/start-date/index?from=renewal'
          : '/pages/home/index';
        setTimeout(() => wx.reLaunch({ url: dest }), 1000);
      } catch (err) {
        wx.hideLoading();
        console.error('Save error:', err);
        wx.showToast({ title: 'Failed to save', icon: 'none' });
      }
    } else {
      const dayIndex = DAYS.findIndex(d => d.key === currentDay);
      this.loadMenu(DAYS[dayIndex + 1].key);
    }
  },

  async saveMealSelections(clientId, allSelections) {
    const dayMap = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
    for (const [key, label] of Object.entries(dayMap)) {
      const sel = allSelections[key];
      if (!sel || !sel.meal_ids || sel.meal_ids.length === 0) continue;
      // PATCH si existe, POST si no
      const existing = await app.supabase('GET', 'meal_selections', null, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      const payload = {
        client_id: clientId,
        day: label,
        slot: 1,
        meals_json: sel.meal_ids,
        delivery_time: sel.time,
        snack_id: sel.snack_id || null,
        note: sel.notes || '',
      };
      if (existing && existing.length > 0) {
        await app.supabase('PATCH', 'meal_selections', payload, `client_id=eq.${clientId}&day=eq.${label}&slot=eq.1`);
      } else {
        await app.supabase('POST', 'meal_selections', payload);
      }
    }
  },

  goBack() { wx.navigateBack(); },
});
