const { getToken, setToken, clearToken, isTokenValid } = require('./utils/auth');
const { api } = require('./utils/api');

App({
  globalData: {
    // 开发时默认连本地，发布后可以在「我的」页里改成线上服务器
    // 微信开发者工具中如需直连本地，请勾选「不校验合法域名」
    defaultApiBaseUrl: 'http://127.0.0.1:8000',
    apiBaseUrl: ''
  },

  onLaunch() {
    this.loadApiBaseUrl();
    this.autoLogin();
  },

  loadApiBaseUrl() {
    const saved = wx.getStorageSync('apiBaseUrl');
    this.globalData.apiBaseUrl = saved || this.globalData.defaultApiBaseUrl;
  },

  updateApiBaseUrl(url) {
    const next = (url || '').trim().replace(/\/+$/, '');
    this.globalData.apiBaseUrl = next || this.globalData.defaultApiBaseUrl;
    wx.setStorageSync('apiBaseUrl', this.globalData.apiBaseUrl);
    return this.globalData.apiBaseUrl;
  },

  autoLogin() {
    if (isTokenValid()) {
      this.loadSummary();
      return;
    }
    wx.login({
      success: (res) => {
        if (!res.code) {
          this.onLoginFailed();
          return;
        }
        api('POST', '/api/wx/login', { code: res.code })
          .then((data) => {
            if (data.needInvite) {
              wx.redirectTo({ url: '/pages/invite/invite?openid=' + encodeURIComponent(data.openid) });
              return;
            }
            setToken(data.token);
            wx.setStorageSync('accountId', data.accountId);
            wx.setStorageSync('accountName', data.accountName);
            this.loadSummary();
          })
          .catch((err) => {
            this.onLoginFailed(err && err.message ? err.message : '');
          });
      },
      fail: () => {
        this.onLoginFailed('');
      }
    });
  },

  onLoginFailed(message) {
    wx.showToast({ title: message || '登录失败，请重试', icon: 'none' });
  },

  loadSummary() {
    api('GET', '/api/summary').then((data) => {
      wx.setStorageSync('summary', data);
    }).catch(() => {});
  }
});
