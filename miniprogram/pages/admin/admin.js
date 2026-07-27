const { get, post, put, del } = require('../../utils/api');

const MODE_OPTIONS = [
  { value: 'off', label: '仅本地' },
  { value: 'demand', label: '点开下载' },
  { value: 'on', label: '持续爬取' },
  { value: 'scheduled', label: '凌晨3点' }
];

Page({
  data: {
    loading: true,
    isAdmin: false,
    accountName: '',
    inviteCodes: [],
    requireInvite: true,
    crawlerMode: 'off',
    crawlerStatusText: '',
    modeOptions: MODE_OPTIONS,
    nicknameStatus: '',
    inviteStatus: ''
  },

  onShow() {
    this.bootstrap();
  },

  bootstrap() {
    this.setData({
      loading: true,
      isAdmin: wx.getStorageSync('isAdmin') === true,
      accountName: wx.getStorageSync('accountName') || ''
    });
    get('/api/accounts').then((data) => {
      if (!data.isAdmin) {
        this.rejectAccess();
        return;
      }
      const current = data.current || {};
      wx.setStorageSync('isAdmin', true);
      if (current.name) {
        wx.setStorageSync('accountName', current.name);
      }
      this.setData({
        loading: false,
        isAdmin: true,
        accountName: current.name || this.data.accountName
      });
      this.loadAdminData();
    }).catch((err) => {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    });
  },

  rejectAccess() {
    wx.setStorageSync('isAdmin', false);
    this.setData({ loading: false, isAdmin: false });
    wx.showToast({ title: '仅管理员可访问', icon: 'none' });
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 400);
  },

  loadAdminData() {
    Promise.all([
      get('/api/invite-codes'),
      get('/api/settings/registration'),
      get('/api/crawler/status')
    ]).then(([inviteData, registrationData, crawlerData]) => {
      this.setData({
        inviteCodes: inviteData.codes || [],
        requireInvite: !!registrationData.requireInvite,
        crawlerMode: crawlerData.mode || 'off',
        crawlerStatusText: this.formatCrawlerStatus(crawlerData)
      });
    }).catch((err) => {
      wx.showToast({ title: err.message || '管理数据加载失败', icon: 'none' });
    });
  },

  formatCrawlerStatus(stats) {
    if (!stats) return '';
    if (stats.reason) return stats.reason;
    const modeLabel = MODE_OPTIONS.find((item) => item.value === stats.mode);
    const label = modeLabel ? modeLabel.label : (stats.mode || '未知');
    const total = Number(stats.total_cards || 0);
    const cached = Number(stats.cached || 0);
    if (total > 0) {
      return `${label} · 已缓存 ${cached}/${total}`;
    }
    return label;
  },

  onGenerateInvite1Day() {
    this.generateInviteCode(1);
  },

  onGenerateInvite10Days() {
    this.generateInviteCode(10);
  },

  generateInviteCode(expiresInDays) {
    post('/api/invite-codes', { expiresInDays }).then((data) => {
      this.setData({
        inviteCodes: data.codes || [],
        inviteStatus: `已生成 ${expiresInDays === 1 ? '24 小时' : `${expiresInDays} 天`}邀请码`
      });
      wx.showToast({ title: '生成成功', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    });
  },

  onToggleInviteRequired() {
    put('/api/settings/registration', { requireInvite: !this.data.requireInvite }).then((data) => {
      this.setData({ requireInvite: !!data.requireInvite });
      wx.showToast({
        title: data.requireInvite ? '已开启邀请码注册' : '已关闭邀请码注册',
        icon: 'none'
      });
    }).catch((err) => {
      wx.showToast({ title: err.message || '设置失败', icon: 'none' });
    });
  },

  onSetCrawlerMode(e) {
    const mode = e.currentTarget.dataset.mode;
    put('/api/crawler/mode', { mode }).then((data) => {
      this.setData({
        crawlerMode: data.mode || mode,
        crawlerStatusText: `${this.formatCrawlerStatus({ mode: data.mode || mode })} · 下载${data.downloadEnabled ? '已开启' : '已关闭'}`
      });
      wx.showToast({ title: '模式已更新', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '更新失败', icon: 'none' });
    });
  },

  onReloadNicknames() {
    post('/api/nicknames/reload').then((data) => {
      const count = Number(data.count || 0);
      this.setData({ nicknameStatus: `已重载 ${count} 条昵称` });
      wx.showToast({ title: '重载完成', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '重载失败', icon: 'none' });
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
