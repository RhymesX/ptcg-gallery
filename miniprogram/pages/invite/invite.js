const { post } = require('../../utils/api');
const { setToken } = require('../../utils/auth');

Page({
  data: {
    openid: '',
    mode: 'invite',
    inviteCode: '',
    bindCode: '',
    error: '',
    submitting: false
  },

  onLoad(options) {
    const openid = options.openid || '';
    if (!openid) {
      wx.showToast({ title: '登录信息丢失，请重试', icon: 'none' });
      return;
    }
    this.setData({ openid });
  },

  switchToInvite() {
    this.setData({ mode: 'invite', error: '' });
  },

  switchToBind() {
    this.setData({ mode: 'bind', error: '' });
  },

  onCodeInput(e) {
    this.setData({ inviteCode: e.detail.value, error: '' });
  },

  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value, error: '' });
  },

  onSubmit() {
    if (this.data.mode === 'invite') {
      this.submitInvite();
    } else {
      this.submitBind();
    }
  },

  submitInvite() {
    const code = this.data.inviteCode.trim();
    if (!code) {
      this.setData({ error: '请输入邀请码' });
      return;
    }
    this.setData({ submitting: true, error: '' });

    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({ error: '获取微信凭证失败', submitting: false });
          return;
        }
        post('/api/wx/login', { code: res.code, inviteCode: code }).then((data) => {
          if (data.needInvite) {
            this.setData({ error: '邀请码无效或已过期', submitting: false });
            return;
          }
          setToken(data.token);
          wx.setStorageSync('accountId', data.accountId);
          wx.setStorageSync('accountName', data.accountName);
          wx.redirectTo({ url: '/pages/holdings/holdings' });
        }).catch((err) => {
          this.setData({
            error: err.message || '验证失败',
            submitting: false
          });
        });
      },
      fail: () => {
        this.setData({ error: '微信登录失败，请重试', submitting: false });
      }
    });
  },

  submitBind() {
    const code = this.data.bindCode.trim();
    if (code.length !== 6) {
      this.setData({ error: '请输入 6 位绑定码' });
      return;
    }
    this.setData({ submitting: true, error: '' });

    post('/api/wx/bind', { code, openid: this.data.openid }).then((data) => {
      setToken(data.token);
      wx.setStorageSync('accountId', data.accountId);
      wx.setStorageSync('accountName', data.accountName);
      wx.redirectTo({ url: '/pages/holdings/holdings' });
    }).catch((err) => {
      this.setData({
        error: err.message || '绑定失败',
        submitting: false
      });
    });
  }
});
