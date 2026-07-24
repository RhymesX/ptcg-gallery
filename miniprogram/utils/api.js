const { getToken, clearToken } = require('./auth');

function getBaseUrl() {
  const app = getApp();
  const baseUrl = app && app.globalData && app.globalData.apiBaseUrl;
  if (baseUrl) return baseUrl;
  return (app && app.globalData && app.globalData.defaultApiBaseUrl) || '';
}

function api(method, path, data) {
  const token = getToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: getBaseUrl() + path,
      method: method,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : ''
      },
      data: data,
      success(res) {
        if (res.statusCode === 401) {
          clearToken();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error('未登录'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          const errMsg = (res.data && res.data.error) || '请求失败';
          reject(new Error(errMsg));
        }
      },
      fail(err) {
        wx.showToast({ title: '网络错误', icon: 'none' });
        reject(err);
      }
    });
  });
}

function get(path, params = {}) {
  const query = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const url = query ? path + '?' + query : path;
  return api('GET', url);
}

function post(path, data) {
  return api('POST', path, data);
}

function put(path, data) {
  return api('PUT', path, data);
}

function del(path) {
  return api('DELETE', path);
}

module.exports = { api, get, post, put, del };
