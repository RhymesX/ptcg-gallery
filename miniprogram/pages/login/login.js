const { isTokenValid } = require('../../utils/auth');

let pollingTimer = null;

Page({
  data: {
    loading: true
  },

  onLoad() {
    if (isTokenValid()) {
      wx.redirectTo({ url: '/pages/holdings/holdings' });
    }
  },

  onShow() {
    if (isTokenValid()) {
      wx.redirectTo({ url: '/pages/holdings/holdings' });
      return;
    }
    this.doLogin();
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
  }
});
