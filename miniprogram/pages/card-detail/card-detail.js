const { get, post, del } = require('../../utils/api');

Page({
  data: {
    card: null,
    decks: [],
    freeAdjustAmount: 1,
    deckPickerVisible: false,
    selectedDeckId: 0,
    deckActionAmount: 1,
    consumeFree: false
  },

  onLoad(options) {
    const cardId = parseInt(options.id);
    if (cardId) {
      this.loadCard(cardId);
      this.loadDecks();
    }
  },

  loadCard(cardId) {
    get('/api/cards/' + cardId).then((data) => {
      this.setData({ card: data });
      this.loadCardImage(data);
    }).catch((err) => {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    });
  },

  loadCardImage(card) {
    const baseUrl = (getApp() && getApp().globalData && getApp().globalData.apiBaseUrl) || '';
    if (!card.cardName) return;
    get('/api/images/lookup', {
      name: card.cardName,
      productCode: card.productCode || '',
      cardCode: card.cardCode || ''
    }).then((res) => {
      if (res.url) {
        this.setData({ cardImageUrl: baseUrl + res.url });
      }
    }).catch(() => {});
  },

  loadDecks() {
    get('/api/decks').then((data) => {
      this.setData({ decks: data.items || [] });
    }).catch(() => {});
  },

  onFreeDeltaInput(e) {
    this.setData({ freeAdjustAmount: parseInt(e.detail.value) || 1 });
  },

  addFree() {
    const cardId = this.data.card ? this.data.card.id : 0;
    if (!cardId) return;
    const amount = this.data.freeAdjustAmount || 1;
    post('/api/cards/' + cardId + '/free-adjust', { delta: amount }).then((data) => {
      this.setData({ card: data });
    }).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  removeFree() {
    const cardId = this.data.card ? this.data.card.id : 0;
    if (!cardId) return;
    const amount = -(this.data.freeAdjustAmount || 1);
    post('/api/cards/' + cardId + '/free-adjust', { delta: amount }).then((data) => {
      this.setData({ card: data });
    }).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  showDeckPicker() {
    this.setData({
      deckPickerVisible: true,
      selectedDeckId: this.data.decks.length > 0 ? this.data.decks[0].id : 0
    });
  },

  hideDeckPicker() {
    this.setData({ deckPickerVisible: false });
  },

  onDeckSelect(e) {
    this.setData({ selectedDeckId: parseInt(e.currentTarget.dataset.deckId) });
  },

  onActionAmountInput(e) {
    this.setData({ deckActionAmount: parseInt(e.detail.value) || 1 });
  },

  onConsumeFreeToggle() {
    this.setData({ consumeFree: !this.data.consumeFree });
  },

  addToDeck() {
    const cardId = this.data.card ? this.data.card.id : 0;
    if (!cardId || !this.data.selectedDeckId) return;

    post('/api/cards/' + cardId + '/add-to-deck', {
      deckId: this.data.selectedDeckId,
      amount: this.data.deckActionAmount,
      consumeFree: this.data.consumeFree
    }).then((data) => {
      this.setData({ card: data, deckPickerVisible: false });
      wx.showToast({ title: '已加入卡组', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  removeFromDeck() {
    const cardId = this.data.card ? this.data.card.id : 0;
    if (!cardId || !this.data.selectedDeckId) return;

    post('/api/cards/' + cardId + '/remove-from-deck', {
      deckId: this.data.selectedDeckId,
      amount: this.data.deckActionAmount,
      backToFree: this.data.consumeFree
    }).then((data) => {
      this.setData({ card: data, deckPickerVisible: false });
      wx.showToast({ title: '已移出卡组', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    });
  },

  deleteCard() {
    const cardId = this.data.card ? this.data.card.id : 0;
    if (!cardId) return;
    wx.showModal({
      title: '确认删除',
      content: '将从库存中完全删除此卡牌',
      success: (res) => {
        if (res.confirm) {
          del('/api/cards/' + cardId).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 1500);
          }).catch((err) => {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          });
        }
      }
    });
  }
});
