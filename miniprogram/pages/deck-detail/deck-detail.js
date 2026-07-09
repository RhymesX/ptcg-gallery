const { get, post } = require('../../utils/api');

// 图片模式排序：宝可梦、物品、支援者、宝可梦道具、竞技场、能量、备卡
const IMAGE_ORDER = ['pokemon', 'item', 'supporter', 'tool', 'stadium', 'energy', 'backup'];

Page({
  data: {
    deck: null,
    sections: [],
    leftSections: [],
    rightSections: [],
    fullSections: [],
    imageCards: [],
    loading: true,
    deckId: 0,
    energyCount: 0,
    viewMode: 'text'
  },

  onLoad(options) {
    const deckId = options.id ? parseInt(options.id) : 0;
    this.setData({ deckId });
    if (deckId) this.loadDeck(deckId);
  },

  onShow() {
    if (this.data.deckId && !this.data.deck) {
      this.loadDeck(this.data.deckId);
    }
  },

  loadDeck(deckId) {
    this.setData({ loading: true, sections: [], deck: null });
    wx.showNavigationBarLoading();
    get('/api/decks/' + deckId).then((data) => {
      wx.hideNavigationBarLoading();
      const energyCount = (data.basicEnergies || []).reduce((sum, e) => sum + (e.quantity || 0), 0);
      const sections = data.sections || [];
      const leftSections = sections.filter(s => s.column === 'left');
      const rightSections = sections.filter(s => s.column === 'right');
      const fullSections = sections.filter(s => s.column === 'full');

      const sectionMap = {};
      sections.forEach(s => { sectionMap[s.key] = s; });
      const imageCards = [];
      IMAGE_ORDER.forEach(key => {
        const sec = sectionMap[key];
        if (sec && sec.items) {
          sec.items.forEach(item => { imageCards.push(item); });
        }
      });

      this.setData({
        deck: data,
        sections,
        leftSections,
        rightSections,
        fullSections,
        imageCards,
        energyCount,
        loading: false
      });
      if (this.data.viewMode === 'image') {
        this.loadAllImages();
      }
    }).catch((err) => {
      wx.hideNavigationBarLoading();
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    });
  },

  loadAllImages() {
    const { post } = require('../../utils/api');
    const baseUrl = (getApp() && getApp().globalData && getApp().globalData.apiBaseUrl) || '';
    const cards = [];
    const imageCards = this.data.imageCards;
    imageCards.forEach((item, idx) => {
      if (!item.id || item.deckEntryType === 'basic_energy') return;
      cards.push({
        name: item.cardName || '',
        productCode: item.productCode || '',
        cardCode: item.cardCode || ''
      });
      // store index on item for later lookup
      item._imgIdx = idx;
    });
    if (cards.length === 0) return;
    post('/api/images/lookup-batch', { cards }).then((res) => {
      const urls = res.urls || {};
      const updates = {};
      imageCards.forEach((item, idx) => {
        const key = `${item.cardName || ''}|${item.productCode || ''}|${item.cardCode || ''}`;
        if (urls[key]) {
          updates['imageCards[' + idx + '].imageUrl'] = baseUrl + urls[key];
        }
      });
      if (Object.keys(updates).length > 0) {
        this.setData(updates);
      }
    }).catch(() => {});
  },

  switchToText() {
    this.setData({ viewMode: 'text' });
  },

  switchToImage() {
    this.setData({ viewMode: 'image' });
    if (this.data.imageCards.length > 0) {
      this.loadAllImages();
    }
  },

  onCardTap(e) {
    const cardId = e.currentTarget.dataset.cardId;
    if (cardId) {
      wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + cardId });
    }
  },

  goToSearch() { wx.redirectTo({ url: '/pages/search/search' }); },
  goToHoldings() { wx.redirectTo({ url: '/pages/holdings/holdings' }); },
  goToDecks() { wx.redirectTo({ url: '/pages/decks/decks' }); },
  goToProfile() { wx.redirectTo({ url: '/pages/profile/profile' }); }
});
