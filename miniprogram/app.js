const { getToken, setToken, clearToken, isTokenValid } = require('./utils/auth');
const { api } = require('./utils/api');

App({
  globalData: {
    // 开发时改成本地地址，上线后改成 https://你的域名
    // 微信开发者工具中需勾选「不校验合法域名」
    apiBaseUrl: 'http://127.0.0.1:8000'
  },

  onLaunch() {
    this.autoLogin();
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
            this.onLoginFailed();
          });
      },
      fail: () => {
        this.onLoginFailed();
      }
    });
  },

  onLoginFailed() {
    wx.showToast({ title: '登录失败，请重试', icon: 'none' });
  },

  loadSummary() {
    api('GET', '/api/summary').then((data) => {
      wx.setStorageSync('summary', data);
    }).catch(() => {});
  }
});
