"""tcg.mik.moe 简中卡图数据源。

数据来源: https://tcg.mik.moe (Cryst's Cards Database)
API 端点: POST /api/v3/card/product-detail
图片 CDN: https://tcg.mik.moe/static/img/{setCode}/{cardIndex}.png

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠ 使用约定
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 仅限个人非商业用途
- 慢速爬取（默认 2s/请求），不影响网站正常服务
- 图片下载后本地缓存，不重复请求
- 如网站方要求停止，请立即删除此模块
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import hashlib
import threading
import time
from pathlib import Path
from typing import Any

import requests

from .app_log import debug, error, info, warning

MIKMOE_API = "https://tcg.mik.moe/api/v3"
CDN_BASE = "https://tcg.mik.moe/static/img"
REQUEST_INTERVAL = 2.0  # 请求间隔（秒），尊重对方服务器
INDEX_CACHE_TTL = 86400  # 产品索引缓存 24 小时

HEADERS = {
    "User-Agent": "ptcg-gallery/1.0 (personal use; contact via GitHub)",
    "Content-Type": "application/json",
}

# (setCode, cardName) → cardIndex (同名→列表)
_index: dict[tuple[str, str], str | list[str]] = {}
_index_lock = threading.Lock()
_index_timestamps: dict[str, float] = {}  # setCode → 索引构建时间
_last_request = 0.0
_req_lock = threading.Lock()


def _rate_limit():
    """慢速请求控制。"""
    global _last_request
    with _req_lock:
        elapsed = time.monotonic() - _last_request
        if elapsed < REQUEST_INTERVAL:
            time.sleep(REQUEST_INTERVAL - elapsed)
        _last_request = time.monotonic()


def _api_post(path: str, body: dict[str, Any]) -> Any:
    _rate_limit()
    try:
        r = requests.post(f"{MIKMOE_API}{path}", json=body, headers=HEADERS, timeout=10)
        if r.status_code == 429:
            time.sleep(5)
            return _api_post(path, body)
        r.raise_for_status()
        data = r.json()
        if data.get("code") != 200:
            debug("mikmoe API 错误", path=path, api_msg=data.get("msg", ""))
            return None
        return data.get("data")
    except Exception as exc:
        debug("mikmoe API 失败", path=path, error=str(exc))
        return None


def _ensure_product_index(set_code: str) -> bool:
    """确保指定产品的卡片索引已加载。返回 True 表示成功加载。"""
    with _index_lock:
        ts = _index_timestamps.get(set_code, 0)
        if ts and time.monotonic() - ts < INDEX_CACHE_TTL:
            return True  # 缓存有效

    debug("加载产品索引", set_code=set_code)
    data = _api_post("/card/product-detail", {"setId": set_code})
    if not data:
        warning("无法加载产品索引", set_code=set_code)
        return False

    cards = data.get("cards", [])
    if not cards:
        return False

    with _index_lock:
        for card in cards:
            key = (card["setCode"], card["cardName"])
            existing = _index.get(key)
            if existing is None:
                _index[key] = card["cardIndex"]
            elif isinstance(existing, list):
                existing.append(card["cardIndex"])
            else:
                _index[key] = [existing, card["cardIndex"]]
            # 同时为去【】括号版本建索引（数据库可能用带括号的名字）
            normalized = card["cardName"].replace("【", "").replace("】", "")
            if normalized != card["cardName"]:
                nk = (card["setCode"], normalized)
                if nk not in _index:
                    _index[nk] = card["cardIndex"]
        _index_timestamps[set_code] = time.monotonic()

    name_sample = cards[0]["cardName"] if cards else "?"
    info("产品索引已加载", set_code=set_code, cards=len(cards), sample=name_sample)
    return True


def get_card_index(product_code: str, card_name: str, card_code: str = "") -> str | None:
    """获取 mikmoe 上的 cardIndex。

    PROMO 系列：cardIndex = card_code 中 '/' 前数字，setId 由后缀推断。
    标准系列：通过产品索引 + 卡名匹配。
    """
    name = card_name.strip()
    cc = card_code.strip()
    if not name:
        return None

    # ── PROMO：有数字编号直接用，否则走名字索引查找 ──
    promo_set = _resolve_promo_set_code(product_code, card_code)
    if promo_set:
        num = _extract_number(card_code)
        if num:
            return num.zfill(3)
        # card_code 无数字（如 S-P），用卡名在 PROMO 索引中查找
        set_code = promo_set
    else:
        # ── 标准系列 ──
        set_code = _normalize_product_code(product_code)

    if not set_code:
        return None

    cc_num = cc.lstrip("0")

    def _lookup(card_name_key: str):
        with _index_lock:
            return _index.get((set_code, card_name_key))

    cached = _lookup(name)
    if cached is not None:
        return _pick_best(cached, cc_num)

    # 【】括号 → 去括号重试（基本【妖】能量 → 基本妖能量）
    name_no_bracket = name.replace("【", "").replace("】", "")
    if name_no_bracket != name:
        cached = _lookup(name_no_bracket)
        if cached is not None:
            return _pick_best(cached, cc_num)

    # 球闪后缀 → 用普通名重试
    base_name = _strip_ball_flash(name)
    if base_name != name:
        cached = _lookup(base_name)
        if cached is not None:
            return _pick_best(cached, cc_num)

    # 括号内容 → 用基础名重试（老大的指令（坂木）→ 老大的指令）
    clean_name = _strip_card_name_parens(name)
    if clean_name != name:
        cached = _lookup(clean_name)
        if cached is not None:
            return _pick_best(cached, cc_num)

    if not _ensure_product_index(set_code):
        return None

    cached = _lookup(name)
    if cached is None:
        cached = _lookup(base_name)
    if cached is None:
        cached = _lookup(clean_name)
    return _pick_best(cached, cc_num) if cached else None


def _pick_best(cached: str | list[str] | None, card_code: str) -> str | None:
    """从索引结果中选出匹配 card_code 编号的 cardIndex。"""
    if cached is None:
        return None
    if isinstance(cached, str):
        return cached
    cc_num = _extract_number(card_code)
    if not cc_num:
        return cached[0]
    for idx in cached:
        if _extract_number(idx) == cc_num:
            return idx
    return cached[0]


# ── 卡名净化 ──────────────────────────────────────────────────

_BALL_FLASH_SUFFIXES = ("·精灵球闪", "·大师球闪", "·球闪", "·甲·闪", "·闪")


def _strip_ball_flash(name: str) -> str:
    """'铝钢桥龙·精灵球闪' → '铝钢桥龙'。"""
    for sfx in _BALL_FLASH_SUFFIXES:
        if name.endswith(sfx):
            return name[:-len(sfx)].rstrip("·").strip()
    return name


# 卡名中括号内容不需要匹配（如"老大的指令（坂木）" → "老大的指令"）
_CARD_NAME_BASE_PREFIXES = ("老大的指令", "博士的研究", "宝可梦交替", "宝可梦捕捉器", "裁判", "巢穴球")


def _strip_card_name_parens(name: str) -> str:
    """'老大的指令（坂木）' → '老大的指令'。"""
    import re
    for prefix in _CARD_NAME_BASE_PREFIXES:
        if name.startswith(prefix):
            return re.sub(r"[（(][^)）]*[)）]", "", name).strip()
    return name


def _extract_number(code: str) -> str | None:
    """'054/072' → '54', '081' → '81'。非数字返回 None。"""
    part = code.strip().split("/")[0].lstrip("0")
    return part if part.isdigit() else None


# ── product_code 规范化 ──────────────────────────────────────

# card_code 后缀 → mikmoe setId 映射（PROMO 系列）
# 例如 card_code="049/S-P" → setId=SSP, cardIndex="049"
_PROMO_SUFFIX_MAP: dict[str, str] = {
    "SM-P": "SMP",
    "S-P": "SSP",
    "SV-P": "SVP",
    "30th-P": "30thP",
}

# DB product_code → mikmoe setId 映射
_PRODUCT_CODE_ALIASES: dict[str, str] = {
    # 151C1/2/3/4 系列 → 商品 ID 统一为 151C
    "151C1": "151C", "151C2": "151C", "151C3": "151C", "151C4": "151C",
    # CSVE 子系列去末尾数字 → 父产品
    "CSVE1C1": "CSVE1C", "CSVE1C2": "CSVE1C", "CSVE1pC2": "CSVE1pC",
    "CSVE2C1": "CSVE2C", "CSVE2C2": "CSVE2C", "CSVE2pC2": "CSVE2pC",
    # 四方联结子系列 → CSEC
    "CSEC1": "CSEC", "CSEC2": "CSEC", "CSEC4": "CSEC",
    # 伊布进阶子系列 → CSHC
    "CSHC1": "CSHC", "CSHC2": "CSHC",
    # PROMO SV 系列 → SVP（带 suffix 映射也覆盖，显式映射兜底）
    "PROMO21": "SVP", "PROMOSV01": "SVP", "PROMOSV02": "SVP",
    "PROMOSV03": "SVP", "PROMOSV04": "SVP", "PROMOSV05": "SVP",
    "PROMOSV06": "SVP", "PROMOSV07": "SVP", "PROMOSV08": "SVP",
    "PROMOSV151m1": "SVP", "PROMOSV151m2": "SVP", "PROMOSV151m3": "SVP",
    "PROMOSVEVENT01": "SVP", "PROMOSVEVENT02": "SVP",
    "PROMOSVML03": "SVP", "PROMOSVML04": "SVP",
    "PROMOCBB01": "SVP", "PROMOGIFT01": "SVP", "PROMOGIFT02": "SVP",
    "promosvPaldea": "SVP", "151PROMOf": "SVP", "151PROMOf2": "SVP",
    # PROMO SM/S 系列
    "PROMO": "SMP", "PROMO1": "SMP", "PROMO2": "SMP",
    "PROMO3": "SSP", "PROMO4": "SSP", "PROMO6": "SSP",
    "PROMO7": "SSP", "PROMO8": "SSP", "PROMO9": "SSP",
    "PROMO10": "SSP", "PROMO11": "SSP", "PROMO12": "SSP",
    "PROMO13": "SSP", "PROMO14": "SSP", "PROMO15": "SSP",
    "PROMO16": "SSP", "PROMO17": "SSP", "PROMO18": "SSP",
    "PROMO19": "SSP", "PROMO20": "SSP",
    "PROMO22": "SSP", "PROMO23": "SSP", "PROMO24": "SSP",
    "PROMO25": "SSP", "PROMO26": "SSP", "PROMO27": "SSP",
    # 30th PR
    "30th-P-01": "30thP",
    # MISSION 系列 → card_code 后缀 SV-P → SVP
    "MISSION01": "SVP", "MISSION02": "SVP", "MISSION03": "SVP",
    "MISSION04": "SVP", "MISSION05": "SVP", "MISSION06": "SVP",
    "MISSION07": "SVP",
}

# card_code 后缀 → mikmoe setId 映射（PROMO 系列）
# 例如 card_code="049/S-P" → setId=SSP, cardIndex="049"
_PROMO_SUFFIX_MAP: dict[str, str] = {
    "SM-P": "SMP",
    "S-P": "SSP",
    "SV-P": "SVP",
    "30th-P": "30thP",
}

def normalize_product_code(pc: str) -> str:
    """规范化 product_code 以匹配 mikmoe 的 setId。先原样查，再大写查。"""
    key = pc.strip()
    if key in _PRODUCT_CODE_ALIASES:
        return _PRODUCT_CODE_ALIASES[key]
    return _PRODUCT_CODE_ALIASES.get(key.upper(), key)


# backward compat
_normalize_product_code = normalize_product_code


def _resolve_promo_set_code(product_code: str, card_code: str) -> str | None:
    """根据 card_code 后缀确定 mikmoe 上的 PROMO setId。"""
    cc = card_code.strip()
    for suffix, set_id in _PROMO_SUFFIX_MAP.items():
        if cc.endswith(suffix) or cc == suffix:
            return set_id
    return None


def fetch_mikmoe_image(card_name: str, product_code: str, card_code: str) -> str | None:
    """获取 mikmoe 上的简中卡图远程 URL。返回 None 表示未找到。"""
    index = get_card_index(product_code, card_name, card_code)
    if not index:
        return None
    # 确定 setId：PROMO 用 suffix 映射，标准系列用 normalize
    promo_set = _resolve_promo_set_code(product_code, card_code)
    set_code = promo_set if promo_set else _normalize_product_code(product_code)
    return f"{CDN_BASE}/{set_code}/{index}.png"


def build_cache_key(card_name: str, product_code: str, card_code: str) -> str:
    """生成缓存 key（与 ImageService 兼容）。"""
    raw = f"{card_name}|{product_code}|{card_code}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ═══════════════════════════════════════════════════════════════
# 独立爬虫函数（供 crawler.py 调用）
# ═══════════════════════════════════════════════════════════════


def crawl_card_image(
    card_name: str, product_code: str, card_code: str, cache_dir: Path
) -> bool:
    """下载单张卡图到缓存目录。返回 True 表示下载成功。"""
    image_url = fetch_mikmoe_image(card_name, product_code, card_code)
    if not image_url:
        return False

    key = build_cache_key(card_name, product_code, card_code)
    for ext in (".png", ".jpg", ".webp"):
        if (cache_dir / f"{key}{ext}").exists():
            return True  # 已缓存

    try:
        _rate_limit()
        resp = requests.get(image_url, timeout=10, headers={"User-Agent": HEADERS["User-Agent"]})
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        ct = resp.headers.get("Content-Type", "")
        ext = ".png"
        if "jpeg" in ct or "jpg" in ct:
            ext = ".jpg"
        elif "webp" in ct:
            ext = ".webp"
        (cache_dir / f"{key}{ext}").write_bytes(resp.content)
        return True
    except Exception as exc:
        debug("mikmoe 下载失败", card=card_name, err=str(exc))
        return False


def get_product_list() -> list[dict[str, Any]]:
    """获取 mikmoe 上的完整产品列表。"""
    data = _api_post("/card/product-list", {})
    return data.get("list", []) if data else []
