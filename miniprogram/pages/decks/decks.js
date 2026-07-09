const { get, post, put, del } = require('../../utils/api');

Page({
  data: {
    decks: [],
    showCreateModal: false,
    newDeckName: ''
  },

  onShow() {
    this.loadDecks();
  },

  loadDecks() {
    get('/api/decks').then((data) => {
      this.setData({ decks: data.items || [] });
    }).catch(() => {});
  },

  onCreateDeck() {
    const name = this.data.newDeckName.trim();
    if (!name) {
      wx.showToast({ title: '请输入卡组名称', icon: 'none' });
      return;
    }
    post('/api/decks', { name }).then(() => {
      this.setData({ showCreateModal: false, newDeckName: '' });
      this.loadDecks();
    }).catch((err) => {
      wx.showToast({ title: err.message || '创建失败', icon: 'none' });
    });
  },

  showCreate() {
    this.setData({ showCreateModal: true, newDeckName: '' });
  },

  hideCreate() {
    this.setData({ showCreateModal: false });
  },

  onNameInput(e) {
    this.setData({ newDeckName: e.detail.value });
  },

  onDeckTap(e) {
    const deckId = e.currentTarget.dataset.deckId;
    wx.navigateTo({ url: '/pages/deck-detail/deck-detail?id=' + deckId });
  },

  onDeleteDeck(e) {
    const deckId = e.currentTarget.dataset.deckId;
    wx.showModal({
      title: '确认删除',
      content: '删除卡组后，卡牌将归还到自由库存',
      success: (res) => {
        if (res.confirm) {
          del('/api/decks/' + deckId).then(() => {
            this.loadDecks();
            wx.showToast({ title: '已删除', icon: 'success' });
          }).catch((err) => {
            wx.showToast({ title: err.message || '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  goToSearch() {
    wx.redirectTo({ url: '/pages/search/search' });
  },

  goToHoldings() {
    wx.redirectTo({ url: '/pages/holdings/holdings' });
  },

  goToProfile() {
    wx.redirectTo({ url: '/pages/profile/profile' });
  }
});
