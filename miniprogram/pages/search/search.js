const { get, put } = require('../../utils/api');

Page({
  data: {
    query: '',
    results: [],
    regulations: [],
    selectedRegulations: [],
    considerSameNameRegulation: true,
    searching: false
  },

  onShow() {
    this.loadOptions();
  },

  onSearchInput(e) {
    this.setData({ query: e.detail.value });
  },

  doSearch() {
    const { query, selectedRegulations, considerSameNameRegulation } = this.data;
    if (!query.trim()) return;
    this.setData({ searching: true });

    const params = { q: query };
    params.regulation = selectedRegulations;
    params.considerSameNameRegulation = considerSameNameRegulation ? 'true' : 'false';
    get('/api/search', params).then((data) => {
      const items = (data.items || []).map(item => ({
        ...item,
        imageUrl: ''  // placeholder
      }));
      this.setData({ results: items, searching: false });
      this.loadCardImages(items);
    }).catch(() => {
      this.setData({ searching: false });
    });
  },

  loadCardImages(items) {
    const baseUrl = (getApp() && getApp().globalData && getApp().globalData.apiBaseUrl) || '';
    items.forEach((item, index) => {
      const params = 'name=' + encodeURIComponent(item.cardName || '')
        + '&productCode=' + encodeURIComponent(item.productCode || '')
        + '&cardCode=' + encodeURIComponent(item.cardCode || '');
      get('/api/images/lookup?' + params).then((res) => {
        if (res.url) {
          const key = 'results[' + index + '].imageUrl';
          this.setData({ [key]: baseUrl + res.url });
        }
      }).catch(() => {});
    });
  },

  loadOptions() {
    get('/api/search/options').then((data) => {
      this.setData({
        regulations: data.regulations || [],
        selectedRegulations: (data.preferences && data.preferences.selectedRegulations) || [],
        considerSameNameRegulation: (data.preferences && data.preferences.considerSameNameRegulation) || false
      });
    }).catch(() => {});
  },

  onRegulationToggle(e) {
    const regulation = e.currentTarget.dataset.regulation;
    let selected = this.data.selectedRegulations.slice();
    const idx = selected.indexOf(regulation);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(regulation);
    }
    this.setData({ selectedRegulations: selected });
    this.savePreferences(selected);
  },

  savePreferences(selectedRegulations) {
    put('/api/search/preferences', {
      selectedRegulations,
      considerSameNameRegulation: this.data.considerSameNameRegulation
    }).catch(() => {});
  },

  onCardTap(e) {
    const cardId = e.currentTarget.dataset.cardId;
    wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + cardId });
  },

  goToHoldings() {
    wx.redirectTo({ url: '/pages/holdings/holdings' });
  },

  goToDecks() {
    wx.redirectTo({ url: '/pages/decks/decks' });
  },

  goToProfile() {
    wx.redirectTo({ url: '/pages/profile/profile' });
  }
});
