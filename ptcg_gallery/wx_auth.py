from __future__ import annotations

import os
import time

import jwt as pyjwt
import requests

WX_LOGIN_URL = "https://api.weixin.qq.com/sns/jscode2session"


def decode_wechat_code(code: str) -> dict:
    """用 wx.login() 返回的临时 code 换取 openid 和 session_key。"""
    appid = os.environ.get("WX_APPID", "")
    secret = os.environ.get("WX_APPSECRET", "")
    if not appid or not secret:
        raise RuntimeError("WX_APPID 和 WX_APPSECRET 环境变量未设置")
    resp = requests.get(
        WX_LOGIN_URL,
        params={
            "appid": appid,
            "secret": secret,
            "js_code": code,
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    data = resp.json()
    if "errcode" in data and data["errcode"] != 0:
        raise RuntimeError(f"微信登录失败: {data.get('errmsg', '未知错误')} (errcode={data['errcode']})")
    return {"openid": data["openid"], "session_key": data.get("session_key", "")}


_jwt_secret = ""


def init_jwt_secret(key: str) -> None:
    global _jwt_secret
    _jwt_secret = key


def _get_jwt_secret() -> str:
    if _jwt_secret:
        return _jwt_secret
    secret = os.environ.get("PTCG_SECRET_KEY", "")
    if not secret:
        secret = os.urandom(24).hex()
    return secret


def create_jwt(account_id: int, account_name: str) -> str:
    """签发 JWT token（24小时有效）。"""
    now = int(time.time())
    payload = {
        "sub": str(account_id),
        "name": str(account_name),
        "iat": now,
        "exp": now + 86400,
    }
    return pyjwt.encode(payload, _get_jwt_secret(), algorithm="HS256")


def verify_jwt(token: str) -> dict | None:
    """验证 JWT token，返回 payload 或 None。"""
    try:
        payload = pyjwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])
        return payload
    except (pyjwt.ExpiredSignatureError, pyjwt.InvalidTokenError):
        return None
