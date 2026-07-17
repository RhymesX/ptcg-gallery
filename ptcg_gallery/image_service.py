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
        self._user_index: dict[str, list[str]] = {}  # normalized_key → [相对路径, ...]
        self._build_user_index()

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

    def reload_user_index(self):
        """重新扫描 card_images_user/ 子目录索引（新增图片后调用）。"""
        self._build_user_index()

    def get_image_url(self, card_name: str, pc: str = "", cc: str = "") -> str | None:
        """非阻塞。缓存命中 → URL；未命中且下载启用 → 入队 → None；下载关闭 → None。"""
        key = self._key(card_name, pc, cc)

        # 1) 用户本地文件（优先级最高，可覆盖 CDN 缓存）
        uf = self._user_file(card_name, pc, cc)
        if uf:
            return uf

        # 2) 本地缓存
        cached = _find_file(self.cache_dir, key)
        if cached:
            return f"/api/images/{key}{cached.suffix}"

        # 3) 负缓存
        if self._neg(key):
            return None

        # 4) 下载关闭 → 不做任何远程请求
        if not self.is_download_enabled():
            return None

        # 5) 入队（按需下载）
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

    @staticmethod
    def _strip_variants(text: str) -> str:
        """去掉卡名中 · 及其后面的变体后缀（·球闪、·1、·B、·獒、·冠军 等）。"""
        # 递归：裁判·藏·闪 → 裁判·藏 → 裁判
        if "·" in text:
            return ImageService._strip_variants(text.rsplit("·", 1)[0])
        return text

    @staticmethod
    def _normalize_energy(text: str) -> str:
        """去掉基本能量名中的【】括号：基本【草】能量 → 基本草能量。"""
        return text.replace("【", "").replace("】", "")

    @staticmethod
    def _normalize_sep(text: str) -> str:
        """统一分隔符：· → 空格，使 DB 中的"神奇糖果·冠军"能匹配文件名"神奇糖果 冠军"。"""
        return text.replace("·", " ")

    def _user_file(self, name: str, pc: str, cc: str) -> str | None:
        """在 card_images_user/ 中查找用户提供的图片（顶层 + 子目录）。"""
        name_stripped = name.strip()
        name_normalized = self._normalize_energy(name_stripped)
        name_space = self._normalize_sep(name_normalized)
        base_name = self._strip_variants(name_normalized).strip()
        base_pc_name = f"{pc}-{base_name}" if base_name else ""
        candidates = [f"{pc}-{cc}", f"{pc}_{cc}", name_stripped, name_normalized, f"{pc}-{name_stripped}", f"{pc}-{name_normalized}"]
        if name_space != name_normalized:
            candidates.extend([name_space, f"{pc}-{name_space}"])
        if base_name and base_name != name_normalized:
            candidates.extend([base_name, base_pc_name])

        # 顶层精确匹配
        for attempt in candidates:
            if not attempt:
                continue
            for ext in (".jpg", ".png", ".webp"):
                for cand in (attempt, attempt.lower()):
                    f = self.user_dir / (cand + ext)
                    if f.exists():
                        return f"/api/images/user/{f.name}"

        # 子目录索引匹配
        for pattern in candidates:
            if not pattern:
                continue
            for ext in (".jpg", ".png", ".webp"):
                key = (pattern + ext).lower()
                paths = self._user_index.get(key)
                if paths:
                    # 有多个候选时优先精确匹配 card_name（· 和空格统一后再比）
                    best = paths[0]
                    target_stem = name_normalized.lower()
                    target_stem_alt = target_stem.replace("·", " ")
                    base_stem = base_name.lower()
                    base_stem_alt = base_stem.replace("·", " ")
                    for p in paths:
                        pl = Path(p).stem.lower()
                        if pl.endswith(target_stem) or pl.endswith(target_stem_alt):
                            best = p
                            break
                    else:
                        for p in paths:
                            pl = Path(p).stem.lower()
                            if pl.endswith(base_stem) or pl.endswith(base_stem_alt):
                                best = p
                                break
                    return f"/api/images/user/{best.replace(chr(92), '/')}"

    def _build_user_index(self):
        """递归扫描 card_images_user/ 所有子目录，建立按文件名匹配的索引。"""
        self._user_index.clear()
        count = 0
        for fpath in self.user_dir.rglob("*"):
            if not fpath.is_file():
                continue
            stem = fpath.stem
            ext = fpath.suffix.lower()
            if ext not in (".jpg", ".png", ".webp"):
                continue
            rel = str(fpath.relative_to(self.user_dir))
            self._add_index(f"{stem}{ext}".lower(), rel)
            parts = stem.split("_", 2)
            if len(parts) >= 2:
                pc, cc = parts[0], parts[1]
                self._add_index(f"{pc}-{cc}{ext}".lower(), rel)
                self._add_index(f"{pc}_{cc}{ext}".lower(), rel)
                card_name = parts[2] if len(parts) > 2 else ""
                if card_name:
                    self._add_index(f"{card_name}{ext}".lower(), rel)
                    self._add_index(f"{pc}-{card_name}{ext}".lower(), rel)
                    # 文件名中"·"→空格 与 DB 中"·"的交叉匹配
                    cn_dot = card_name.replace(" ", "·")
                    cn_space = card_name.replace("·", " ")
                    if cn_dot != card_name:
                        self._add_index(f"{cn_dot}{ext}".lower(), rel)
                        self._add_index(f"{pc}-{cn_dot}{ext}".lower(), rel)
                    if cn_space != card_name:
                        self._add_index(f"{cn_space}{ext}".lower(), rel)
                        self._add_index(f"{pc}-{cn_space}{ext}".lower(), rel)
            count += 1
        if count:
            info(f"user index 已构建，共 {count} 文件")

    def _add_index(self, key: str, rel: str):
        if key in self._user_index:
            self._user_index[key].append(rel)
        else:
            self._user_index[key] = [rel]

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
