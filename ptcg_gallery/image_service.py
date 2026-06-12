"""卡牌图片服务 —— 单线程顺序下载 + 多数据源 + 同英文名去重。

┌─ 请求线程 ─────────────────────────────────────────────┐
│  get_image_url() → 缓存命中? → 返回 URL                │
│                  → 缓存未命中? → 入队 → 返回 None       │
│                  (永不阻塞，<1ms)                        │
└────────────────────────────────────────────────────────┘
                           │
                           ▼  (单线程后台队列)
┌─ 后台线程 ─────────────────────────────────────────────┐
│  逐条处理，0.5s 间隔，同英文名只查一次 API              │
│  图片源优先级：用户本地 > mikmoe 简中 > PTCG API 英文   │
└────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

import requests

from .app_log import debug, error, info, warning
from .mikmoe_source import fetch_mikmoe_image  # 简中卡图源

PTCG_API = "https://api.pokemontcg.io/v2"
CACHE_DIR = "card_images"
USER_DIR = "card_images_user"
TIMEOUT = 5  # PTCG API 单次请求超时
INTERVAL = 0.5  # 任务间隔（秒）
API_CACHE_TTL = 60  # 同英文名 API 结果缓存（秒）


# ═══════════════════════════════════════════════════════════════
# 图片源
# ═══════════════════════════════════════════════════════════════

ImageSourceFn = Callable[[str, str, str], str | None]


def source_ptcg_api(card_name: str, product_code: str, card_code: str) -> str | None:
    """PTCG API —— 英文卡图（兜底）。跳过中文名，直接用翻译后的英文名搜索。"""
    clean = card_name.strip()
    if not clean:
        return None

    # 中→英翻译后精确搜索（主策略）
    en = translate_card_name(clean)
    if en:
        url = _api_find(f'name:"{en}"')
        if url:
            return url

    # 去变体后缀再翻译
    s = _simplify(clean)
    if s and s != clean:
        en2 = translate_card_name(s)
        if en2:
            url = _api_find(f'name:"{en2}"')
            if url:
                return url

    return None


def _api_find(q: str) -> str | None:
    data = _api_get("/cards", {"q": q, "pageSize": 3, "orderBy": "set.releaseDate"})
    if not data or "data" not in data or not data["data"]:
        return None
    for card in data["data"]:
        img = (card.get("images") or {}).get("large") or (card.get("images") or {}).get("small")
        if img:
            return img
    return None


def _api_get(path: str, params: dict[str, Any] | None = None) -> Any:
    try:
        t0 = time.monotonic()
        resp = requests.get(f"{PTCG_API}{path}", params=params, timeout=TIMEOUT)
        ms = int((time.monotonic() - t0) * 1000)
        debug("PTCG API", status=resp.status_code, ms=ms, q=str(params.get("q", ""))[:60])
        if resp.status_code == 429:
            time.sleep(1)
            return _api_get(path, params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        debug("PTCG API 失败", error=str(exc))
        return None


# ═══════════════════════════════════════════════════════════════
# Job
# ═══════════════════════════════════════════════════════════════


class _Job:
    __slots__ = ("cache_key", "card_name", "product_code", "card_code")

    def __init__(self, cache_key: str, card_name: str, product_code: str, card_code: str):
        self.cache_key = cache_key
        self.card_name = card_name
        self.product_code = product_code
        self.card_code = card_code


# ═══════════════════════════════════════════════════════════════
# ImageService
# ═══════════════════════════════════════════════════════════════

class ImageService:
    """卡牌图片服务。每张卡独立下载，不共享图片。"""

    def __init__(self, data_dir: Path):
        self.cache_dir = data_dir / CACHE_DIR
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.user_dir = data_dir / USER_DIR
        self.user_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._queue: deque[_Job] = deque()
        self._pending_keys: set[str] = set()
        self._negative: dict[str, float] = {}
        self._download_enabled = True  # True=按需下载, False=仅本地

        self._sources: list[ImageSourceFn] = []

        self._worker = threading.Thread(target=self._loop, daemon=True, name="img-dl")
        self._worker.start()
        info("ImageService 就绪", cache=str(self.cache_dir))

    # ── 公开 API ────────────────────────────────────────────

    def enable_download(self):
        with self._lock: self._download_enabled = True
        info("ImageService: 按需下载已启用")

    def disable_download(self):
        with self._lock: self._download_enabled = False
        info("ImageService: 按需下载已关闭（仅本地）")

    def is_download_enabled(self) -> bool:
        with self._lock: return self._download_enabled

    def get_image_url(self, card_name: str, pc: str = "", cc: str = "") -> str | None:
        """非阻塞。缓存命中 → URL；未命中且下载启用 → 入队 → None；下载关闭 → None。"""
        key = self._key(card_name, pc, cc)

        # 1) 本地缓存
        if _find_file(self.cache_dir, key):
            return f"/api/images/{key}"

        # 2) 用户本地文件
        uf = self._user_file(card_name, pc, cc)
        if uf:
            return uf

        # 3) 负缓存
        if self._neg(key):
            return None

        # 4) 下载关闭 → 不做任何远程请求
        if not self.is_download_enabled():
            return None

        # 5) 入队（按需下载）
        self._enqueue(key, card_name, pc, cc)
        return None

        # 3) 负缓存
        if self._neg(key):
            return None

        # 4) 入队
        self._enqueue(key, card_name, pc, cc)
        return None

    def get_cached_image_path(self, cache_key: str) -> Path | None:
        return _find_file(self.cache_dir, cache_key)

    def add_source(self, fn: ImageSourceFn, first: bool = False):
        """注册自定义图片源。first=True 时插入到最前面（最高优先级）。"""
        if first:
            self._sources.insert(0, fn)
        else:
            self._sources.append(fn)

    # ── 内部 ────────────────────────────────────────────────

    def _key(self, name: str, pc: str, cc: str) -> str:
        return hashlib.sha256(f"{name}|{pc}|{cc}".encode()).hexdigest()[:16]

    def _user_file(self, name: str, pc: str, cc: str) -> str | None:
        """在 card_images_user/ 中查找用户提供的图片。"""
        for attempt in (f"{pc}-{cc}", f"{pc}_{cc}", name.strip(), f"{pc}-{name}"):
            if not attempt:
                continue
            for ext in (".jpg", ".png", ".webp"):
                for candidate in (attempt, attempt.lower()):
                    f = self.user_dir / f"{candidate}{ext}"
                    if f.exists():
                        return f"/api/images/user/{f.name}"
        return None

    def _neg(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            ts = self._negative.get(key)
            if ts is None:
                return False
            if now - ts > 3600:
                del self._negative[key]
                return False
            return True

    def _set_neg(self, key: str):
        with self._lock:
            self._negative[key] = time.monotonic()
            if len(self._negative) > 5000:
                oldest = min(self._negative.items(), key=lambda x: x[1])
                del self._negative[oldest[0]]

    def _enqueue(self, key: str, name: str, pc: str, cc: str):
        with self._lock:
            if key in self._pending_keys:
                return
            self._pending_keys.add(key)
            self._queue.append(_Job(key, name, pc, cc))

    def _loop(self):
        info("图片下载线程启动")
        while True:
            job = None
            with self._lock:
                if self._queue:
                    job = self._queue.popleft()

            if job is None:
                time.sleep(0.3)
                continue

            self._process(job)
            time.sleep(INTERVAL)

    def _process(self, job: _Job):
        try:
            if _find_file(self.cache_dir, job.cache_key):
                return

            debug("按需查图", card=job.card_name)

            # 依次尝试各图片源
            image_url: str | None = None
            for fn in self._sources:
                try:
                    image_url = fn(job.card_name, job.product_code, job.card_code)
                except Exception as exc:
                    warning("源异常", card=job.card_name, err=str(exc))
                if image_url:
                    break

            if not image_url:
                info("无图", card=job.card_name)
                self._set_neg(job.cache_key)
                return

            # 下载到本地缓存
            resp = requests.get(image_url, timeout=TIMEOUT)
            resp.raise_for_status()
            ct = resp.headers.get("Content-Type", "")
            ext = ".jpg"
            if "png" in ct:
                ext = ".png"
            elif "webp" in ct:
                ext = ".webp"

            path = self.cache_dir / f"{job.cache_key}{ext}"
            path.write_bytes(resp.content)
            info("已缓存", card=job.card_name, kb=len(resp.content) // 1024)

        except Exception as exc:
            error("下载失败", card=job.card_name, err=str(exc))
        finally:
            with self._lock:
                self._pending_keys.discard(job.cache_key)


# ═══════════════════════════════════════════════════════════════
# 工具
# ═══════════════════════════════════════════════════════════════

def _find_file(d: Path, key: str) -> Path | None:
    for ext in (".jpg", ".png", ".webp"):
        p = d / f"{key}{ext}"
        if p.exists():
            return p
    return None


def _simplify(name: str) -> str:
    s = re.sub(r"\s*(ex|EX|V|VMAX|VSTAR|V-UNION|GX|BREAK)\s*$", "", name).strip()
    return s if s and s != name else name
