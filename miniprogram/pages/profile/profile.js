const { clearToken } = require('../../utils/auth');
const { get } = require('../../utils/api');

const SHOW_IMAGES_KEY = 'showImages';
const FOLD_NON_POKEMON_KEY = 'foldNonPokemon';
const API_BASE_URL_KEY = 'apiBaseUrl';

Page({
  data: {
    accountName: '',
    showImages: true,
    foldNonPokemon: false,
    apiBaseUrl: '',
    connectionStatus: ''
  },

  onShow() {
    this.setData({
      accountName: wx.getStorageSync('accountName') || '未知用户',
      showImages: wx.getStorageSync(SHOW_IMAGES_KEY) !== false,
      foldNonPokemon: wx.getStorageSync(FOLD_NON_POKEMON_KEY) === true,
      apiBaseUrl: wx.getStorageSync(API_BASE_URL_KEY) || (getApp().globalData.defaultApiBaseUrl || ''),
      connectionStatus: ''
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

  onApiBaseUrlInput(e) {
    this.setData({ apiBaseUrl: e.detail.value });
  },

  onSaveApiBaseUrl() {
    const app = getApp();
    const next = (this.data.apiBaseUrl || '').trim();
    const saved = app.updateApiBaseUrl(next);
    wx.showToast({
      title: saved ? '已保存' : '已恢复默认',
      icon: 'success'
    });
    this.setData({ apiBaseUrl: saved });
  },

  onResetApiBaseUrl() {
    const app = getApp();
    const saved = app.updateApiBaseUrl('');
    wx.showToast({ title: '已恢复默认', icon: 'success' });
    this.setData({ apiBaseUrl: saved });
  },

  testConnection() {
    this.setData({ connectionStatus: '正在连接...' });
    get('/health').then((data) => {
      const stats = data && data.stats ? data.stats : {};
      this.setData({
        connectionStatus: '已连接：' + (stats.accountCount !== undefined ? ('账号 ' + stats.accountCount + ' 个') : '服务器正常')
      });
    }).catch((err) => {
      const msg = err && err.message ? err.message : '连接失败';
      this.setData({ connectionStatus: '连接失败：' + msg });
    });
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
    wx.navigateTo({ url: '/pages/retire/retire' });
  }
});
