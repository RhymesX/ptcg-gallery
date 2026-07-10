const { clearToken } = require('../../utils/auth');

const SHOW_IMAGES_KEY = 'showImages';
const FOLD_NON_POKEMON_KEY = 'foldNonPokemon';

Page({
  data: {
    accountName: '',
    showImages: true,
    foldNonPokemon: false
  },

  onShow() {
    this.setData({
      accountName: wx.getStorageSync('accountName') || '未知用户',
      showImages: wx.getStorageSync(SHOW_IMAGES_KEY) !== false,
      foldNonPokemon: wx.getStorageSync(FOLD_NON_POKEMON_KEY) === true
    });
  },

  onShowImagesChange(e) {
    const showImages = e.detail.value;
    wx.setStorageSync(SHOW_IMAGES_KEY, showImages);
    this.setData({ showImages });
  },

  onFoldNonPokemonChange(e) {
    const fold = e.detail.value;
    wx.setStorageSync(FOLD_NON_POKEMON_KEY, fold);
    this.setData({ foldNonPokemon: fold });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          clearToken();
          wx.removeStorageSync('accountId');
          wx.removeStorageSync('accountName');
          wx.reLaunch({ url: '/pages/login/login' });
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

  goToDecks() {
    wx.redirectTo({ url: '/pages/decks/decks' });
  },

  onRetireTap() {
    wx.showToast({ title: '请在网页端使用此功能', icon: 'none' });
  }
});
