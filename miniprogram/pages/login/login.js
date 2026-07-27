const { isTokenValid } = require('../../utils/auth');
const { get } = require('../../utils/api');

let pollingTimer = null;

const API_BASE_URL_KEY = 'apiBaseUrl';

Page({
  data: {
    loading: true,
    apiBaseUrl: '',
    connectionStatus: '',
    showServerConfig: false
  },

  onLoad() {
    if (isTokenValid()) {
      wx.redirectTo({ url: '/pages/holdings/holdings' });
    }
    const app = getApp();
    const apiBaseUrl = wx.getStorageSync(API_BASE_URL_KEY) || (app.globalData.defaultApiBaseUrl || '');
    this._pendingApiBaseUrl = apiBaseUrl;
    this.setData({
      apiBaseUrl,
      showServerConfig: !!(app.globalData && app.globalData.isDevtools)
    });
  },

  onShow() {
    if (isTokenValid()) {
      wx.redirectTo({ url: '/pages/holdings/holdings' });
      return;
    }
    this.setData({ loading: false });
  },

  onHide() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  },

  onUnload() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  },

  doLogin() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
    }
    this.setData({ loading: true });
    const app = getApp();
    app.autoLogin();
    let attempts = 0;
    pollingTimer = setInterval(() => {
      attempts++;
      if (isTokenValid()) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        wx.redirectTo({ url: '/pages/holdings/holdings' });
      } else if (attempts > 30) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        this.setData({ loading: false, error: '登录超时，请重试' });
      }
    }, 500);
  },

  onApiBaseUrlInput(e) {
    this._pendingApiBaseUrl = e.detail.value;
  },

  onApiBaseUrlBlur(e) {
    const value = e && e.detail ? e.detail.value : this._pendingApiBaseUrl;
    this._pendingApiBaseUrl = value;
    this.setData({ apiBaseUrl: value });
  },

  saveApiBaseUrl() {
    const app = getApp();
    const saved = app.updateApiBaseUrl(this._pendingApiBaseUrl || this.data.apiBaseUrl || '');
    this._pendingApiBaseUrl = saved;
    this.setData({ apiBaseUrl: saved, connectionStatus: '已保存' });
  },

  resetApiBaseUrl() {
    const app = getApp();
    const saved = app.updateApiBaseUrl('');
    this._pendingApiBaseUrl = saved;
    this.setData({ apiBaseUrl: saved, connectionStatus: '已恢复默认' });
  },

  testConnection() {
    this.setData({ connectionStatus: '正在测试连接...' });
    get('/health').then((data) => {
      const stats = data && data.stats ? data.stats : {};
      this.setData({
        connectionStatus: '连接成功'
          + (stats.accountCount !== undefined ? ('，账号数：' + stats.accountCount) : '')
      });
    }).catch((err) => {
      this.setData({
        connectionStatus: '连接失败：' + (err && err.message ? err.message : '未知错误')
      });
    });
  }
});
