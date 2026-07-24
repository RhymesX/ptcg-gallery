const { get, post } = require('../../utils/api');

Page({
  data: {
    regulations: [],
    scopeOptions: [],
    selectedScopeIndex: 0,
    skipSameName: true,
    includeDeckCards: true,
    fullInventoryCheck: true,
    selectedRegulations: [],
    currentRegulationText: '',
    loading: true,
    previewLoading: false,
    executing: false,
    cards: [],
    decks: [],
    totalCount: 0,
    totalQuantity: 0,
    selectedCount: 0,
    selectedQuantity: 0,
    previewNotice: ''
  },

  onLoad() {
    this.loadOptions();
  },

  loadOptions() {
    this.setData({ loading: true, previewNotice: '' });
    get('/api/search/options').then((data) => {
      const regulations = data.regulations || [];
      const prefs = data.preferences || {};
      const selectedRegulations = Array.isArray(prefs.selectedRegulations) ? prefs.selectedRegulations : [];
      const scopeOptions = ['全库存（按当前已选赛制）'].concat(regulations.map(item => item || '无'));
      const selectedScopeIndex = regulations.length > 0 ? 1 : 0;

      this.setData({
        regulations,
        scopeOptions,
        selectedScopeIndex,
        selectedRegulations,
        currentRegulationText: selectedRegulations.length ? '当前已选赛制：' + selectedRegulations.join('、') + ' 标' : '',
        skipSameName: true,
        includeDeckCards: true,
        loading: false
      });
      this.loadPreview();
    }).catch((err) => {
      this.setData({
        loading: false,
        previewNotice: err.message || '加载失败'
      });
    });
  },

  getCurrentScope() {
    const { selectedScopeIndex, regulations } = this.data;
    if (selectedScopeIndex === 0) {
      return { fullInventoryCheck: true, regulation: '' };
    }
    const regulation = regulations[selectedScopeIndex - 1] || '';
    return { fullInventoryCheck: false, regulation };
  },

  onScopeChange(e) {
    const selectedScopeIndex = parseInt(e.detail.value);
    this.setData({ selectedScopeIndex }, () => this.loadPreview());
  },

  onSkipSameNameChange(e) {
    this.setData({ skipSameName: e.detail.value }, () => this.loadPreview());
  },

  onIncludeDeckCardsChange(e) {
    this.setData({ includeDeckCards: e.detail.value }, () => this.loadPreview());
  },

  loadPreview() {
    const { regulation, fullInventoryCheck } = this.getCurrentScope();
    if (fullInventoryCheck && !this.data.selectedRegulations.length) {
      this.setData({
        cards: [],
        decks: [],
        totalCount: 0,
        totalQuantity: 0,
        selectedCount: 0,
        selectedQuantity: 0,
        previewNotice: '全库存模式需要先在搜索页选择至少一个有效赛制。'
      });
      return;
    }

    const params = {
      skipSameName: this.data.skipSameName ? 'true' : 'false',
      includeDeckCards: this.data.includeDeckCards ? 'true' : 'false',
      fullInventoryCheck: fullInventoryCheck ? 'true' : 'false'
    };
    if (regulation) {
      params.regulation = regulation;
    }

    this.setData({ previewLoading: true, previewNotice: '' });
    get('/api/retire/preview', params).then((data) => {
      const cards = (data.cards || []).map(card => ({
        ...card,
        selected: true,
        deckBreakdown: (card.deckBreakdown || []).map(item => ({
          ...item,
          color: ((data.decks || []).find(function (deck) {
            return deck.id === item.deckId;
          }) || {}).color || '#9ca3af'
        }))
      }));
      this.setData({
        cards,
        decks: data.decks || [],
        totalCount: data.totalCount || 0,
        totalQuantity: data.totalQuantity || 0,
        previewLoading: false
      });
      this.updateSelectedCount();
    }).catch((err) => {
      this.setData({
        previewLoading: false,
        cards: [],
        decks: [],
        totalCount: 0,
        totalQuantity: 0,
        selectedCount: 0,
        selectedQuantity: 0,
        previewNotice: err.message || '预览失败'
      });
    });
  },

  toggleCard(e) {
    const idx = parseInt(e.currentTarget.dataset.index);
    const key = 'cards[' + idx + '].selected';
    const next = !this.data.cards[idx].selected;
    this.setData({ [key]: next }, () => this.updateSelectedCount());
  },

  toggleAll() {
    const checked = !(this.data.selectedCount === this.data.cards.length && this.data.cards.length > 0);
    const updates = {};
    this.data.cards.forEach((card, idx) => {
      updates['cards[' + idx + '].selected'] = checked;
    });
    this.setData(updates, () => this.updateSelectedCount());
  },

  updateSelectedCount() {
    const cards = this.data.cards || [];
    let selectedCount = 0;
    let selectedQuantity = 0;
    cards.forEach(card => {
      if (card.selected) {
        selectedCount += 1;
        selectedQuantity += parseInt(card.ownedQuantity) || 0;
      }
    });
    this.setData({ selectedCount, selectedQuantity });
  },

  executeRetire() {
    const cardIds = (this.data.cards || [])
      .filter(card => card.selected)
      .map(card => card.id);
    if (!cardIds.length) {
      wx.showToast({ title: '请至少选择一张卡牌', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认退标',
      content: '确认退标 ' + cardIds.length + ' 种卡牌？此操作不可撤销。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ executing: true });
        post('/api/retire/execute', { cardIds, regulation: this.getCurrentScope().regulation }).then((data) => {
          this.setData({ executing: false });
          wx.showToast({ title: '已退标 ' + (data.removed || 0) + ' 种', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack({ delta: 1 });
          }, 800);
        }).catch((err) => {
          this.setData({ executing: false });
          wx.showToast({ title: err.message || '执行失败', icon: 'none' });
        });
      }
    });
  },

  onCardTap(e) {
    const cardId = e.currentTarget.dataset.cardId;
    if (cardId) {
      wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + cardId });
    }
  },

  goToHoldings() {
    wx.redirectTo({ url: '/pages/holdings/holdings' });
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
