const { getToken, setToken, clearToken, isTokenValid } = require('./utils/auth');
const { api } = require('./utils/api');

App({
  globalData: {
    // 体验版/正式版默认连线上，开发时可在登录页改回本地地址
    // 微信开发者工具如需直连本地，请勾选「不校验合法域名」
    defaultApiBaseUrl: 'https://ptcggallery.rhymesx.top',
    apiBaseUrl: '',
    isDevtools: false
  },

  onLaunch() {
    this.detectRuntime();
    this.loadApiBaseUrl();
    this.autoLogin();
  },

  detectRuntime() {
    try {
      const info = wx.getSystemInfoSync();
      this.globalData.isDevtools = info.platform === 'devtools';
    } catch (_) {
      this.globalData.isDevtools = false;
    }
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
            wx.setStorageSync('isAdmin', !!data.isAdmin);
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
