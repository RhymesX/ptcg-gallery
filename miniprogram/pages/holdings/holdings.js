const { get } = require('../../utils/api');

const POKEMON_KEYS = ['ordinary_pokemon', 'pokemon_gx', 'pokemon_v', 'pokemon_ex', 'radiant_pokemon'];

Page({
  data: {
    allSections: [],
    sections: [],
    deckNames: [],
    deckColors: {},
    filterKeys: [],
    showFilterPicker: false,
    loading: true,
    showImages: true,
    foldNonPokemon: false,
    searchText: '',
    categoryFilters: []
  },

  onShow() {
    this.setData({
      showImages: wx.getStorageSync('showImages') !== false,
      foldNonPokemon: wx.getStorageSync('foldNonPokemon') === true
    });
    this.loadHoldings();
  },

  loadHoldings() {
    this.setData({ loading: true, sections: [], allSections: [] });
    get('/api/holdings').then((data) => {
      const deckNames = data.deckNames || [];
      const decks = data.decks || [];
      const deckColors = {};
      decks.forEach(d => { deckColors[d.name] = d.color || '#9ca3af'; });

      const allSections = (data.sections || []).map(section => ({
        ...section,
        groups: (section.groups || []).map(group => {
          const totalQty = (group.items || []).reduce((sum, card) => sum + (parseInt(card.freeQuantity) || 0) + (parseInt(card.visibleDeckQuantity) || 0), 0);
          return {
            ...group,
            totalQuantity: totalQty,
            items: (group.items || []).map(card => ({ ...card, imageUrl: '' }))
          };
        })
      }));

      const filterKeys = allSections.map(s => ({ key: s.key, title: s.title }));

      this.setData({ deckNames, deckColors, allSections, filterKeys, loading: false });
      this.applyFilters();
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  applyFilters() {
    const { allSections, searchText, categoryFilters, foldNonPokemon } = this.data;
    const q = (searchText || '').trim().toLowerCase();

    let sections = allSections.map(section => {
      const sectionKey = section.key;
      if (categoryFilters.length > 0 && categoryFilters.indexOf(sectionKey) === -1) {
        return null;
      }
      let filteredGroups = section.groups.map(group => {
        let items = group.items;
        if (q) {
          items = items.filter(card =>
            (card.cardName || '').toLowerCase().indexOf(q) >= 0 ||
            (card.displayCode || '').toLowerCase().indexOf(q) >= 0
          );
        }
        if (items.length === 0) return null;

        let displayItems;
        if (foldNonPokemon && POKEMON_KEYS.indexOf(section.key) === -1) {
          let totalFree = 0;
          let totalOwned = 0;
          const mergedDeckQty = {};
          items.forEach(card => {
            totalFree += parseInt(card.freeQuantity) || 0;
            totalOwned += parseInt(card.ownedQuantity) || 0;
            const dq = card.deckQuantities || {};
            Object.keys(dq).forEach(dn => {
              if (dq[dn] > 0) mergedDeckQty[dn] = (mergedDeckQty[dn] || 0) + dq[dn];
            });
          });
          displayItems = [{
            id: items[0].id,
            cardName: items[0].cardName,
            productCode: items[0].productCode,
            cardCode: items[0].cardCode,
            displayCode: items.length + '种',
            freeQuantity: totalFree,
            ownedQuantity: totalOwned,
            deckQuantities: mergedDeckQty,
            isFolded: true,
            firstCardId: items[0].id
          }];
        } else {
          displayItems = items;
        }

        return {
          ...group,
          items: displayItems,
          totalQuantity: displayItems.reduce((s, c) => s + (parseInt(c.freeQuantity) || 0) + (parseInt(c.visibleDeckQuantity || c.deckQuantities ? Object.values(c.deckQuantities || {}).reduce((a, b) => a + b, 0) : 0) || 0), 0)
        };
      }).filter(g => g !== null);

      if (filteredGroups.length === 0) return null;
      return { ...section, groups: filteredGroups };
    }).filter(s => s !== null);

    this.setData({ sections });
    this.loadVisibleImages();
  },

  loadVisibleImages() {
    if (!this.data.showImages) return;
    const baseUrl = (getApp() && getApp().globalData && getApp().globalData.apiBaseUrl) || '';

    // 收集所有需要查图的卡牌，记录其数据路径
    const cards = [];
    const paths = [];
    this.data.sections.forEach((section, si) => {
      (section.groups || []).forEach((group, gi) => {
        (group.items || []).forEach((card, ci) => {
          if (!card.cardName || card._imgLoading || card._imgLoaded) return;
          card._imgLoading = true;
          cards.push({
            name: card.cardName,
            productCode: card.productCode || '',
            cardCode: card.cardCode || ''
          });
          paths.push({ si, gi, ci, card });
        });
      });
    });

    if (cards.length === 0) return;

    const { post } = require('../../utils/api');
    post('/api/images/lookup-batch', { cards }).then((res) => {
      const urls = res.urls || {};
      const updates = {};
      paths.forEach(({ si, gi, ci, card }) => {
        const key = `${card.cardName}|${card.productCode || ''}|${card.cardCode || ''}`;
        const url = urls[key];
        if (url) {
          card._imgLoaded = true;
          updates['sections[' + si + '].groups[' + gi + '].items[' + ci + '].imageUrl'] = baseUrl + url;
        }
      });
      if (Object.keys(updates).length > 0) {
        this.setData(updates);
      }
    }).catch(() => {});
  },

  onSearchInput(e) {
    this.setData({ searchText: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilters(), 200);
  },

  onClearSearch() {
    this.setData({ searchText: '' });
    this.applyFilters();
  },

  showFilterPicker() {
    this.setData({ showFilterPicker: true });
  },

  hideFilterPicker() {
    this.setData({ showFilterPicker: false });
  },

  onFilterClearAll() {
    const filterKeys = this.data.filterKeys.map(fk => ({ ...fk, active: false }));
    this.setData({ categoryFilters: [], filterKeys, showFilterPicker: false });
    this.applyFilters();
  },

  onFilterPickerSelect(e) {
    const key = e.currentTarget.dataset.key;
    let filters = this.data.categoryFilters.slice();
    const idx = filters.indexOf(key);
    if (idx >= 0) filters.splice(idx, 1);
    else filters.push(key);
    const filterKeys = this.data.filterKeys.map(fk => ({
      ...fk,
      active: filters.indexOf(fk.key) >= 0
    }));
    this.setData({ categoryFilters: filters, filterKeys });
    this.applyFilters();
  },

  onCardTap(e) {
    const cardId = e.currentTarget.dataset.cardId || e.currentTarget.dataset.firstCardId;
    if (cardId) {
      wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + cardId });
    }
  },

  goToSearch() {
    wx.redirectTo({ url: '/pages/search/search' });
  },

  goToDecks() {
    wx.redirectTo({ url: '/pages/decks/decks' });
  },

  goToProfile() {
    wx.redirectTo({ url: '/pages/profile/profile' });
  }
});
