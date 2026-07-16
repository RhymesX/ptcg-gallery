"""后台卡图爬虫 —— 三种运行模式。

模式（持久化到 data/crawler_mode.json）:
  off       — 不运行，图片完全按需下载
  on        — 持续运行，逐卡补全
  scheduled — 每天凌晨 3 点自动跑一轮后停止

优先级：mikmoe 简中 > PTCG API 英文兜底。
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

from .app_log import debug, error, info
from .card_translations import translate_card_name
from .mikmoe_source import fetch_mikmoe_image

PTCG_API = "https://api.pokemontcg.io/v2"
TIMEOUT = 8
INTERVAL = 1.5
MODE_FILE = "crawler_mode.json"


class CardCrawler(threading.Thread):
    """后台爬虫。"""

    def __init__(self, db_path: str, cache_dir: Path):
        super().__init__(daemon=True, name="card-crawler")
        self.db_path = db_path
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._mode_path = cache_dir.parent / MODE_FILE

        self._lock = threading.Lock()
        self._active = False
        self._running = True
        self._mode = "off"
        self._load_mode()
        self._wake_event = threading.Event()
        self._priority_queue: list[tuple[int, str, str, str]] = []

        self._stats: dict[str, Any] = {
            "total_cards": 0, "cached": 0, "zh_downloaded": 0,
            "en_downloaded": 0, "skipped": 0, "errors": 0,
            "current_card": "", "current_source": "", "running": False,
            "mode": self._mode,
        }
        self._verify_history: list[dict[str, Any]] = []

    # ── 公开 API ────────────────────────────────────────────

    def set_mode(self, mode: str) -> str:
        mode = mode.strip().lower()
        if mode not in ("off", "on", "scheduled", "demand"):
            raise ValueError(f"不支持的模式: {mode}")
        with self._lock:
            self._mode = mode
            self._stats["mode"] = mode
            if mode == "on":
                self._active = True
            else:
                self._active = False  # off / demand / scheduled(等线程自行启动)
        self._save_mode()
        self._wake_event.set()
        info("爬虫切换模式", mode=mode)
        return mode

    def stats(self) -> dict[str, Any]:
        with self._lock: return dict(self._stats)

    def notify_new_cards(self, card_rows: list[tuple[int, str, str, str]]):
        """通知爬虫有新卡牌导入，优先下载这些卡牌。

        card_rows: [(id, card_name, product_code, card_code), ...]
        """
        with self._lock:
            self._priority_queue.extend(card_rows)
        self._wake_event.set()

    def refresh_stats(self):
        """立即更新 total_cards 和 cached 统计，不等待下一轮 _crawl。"""
        import sqlite3
        with sqlite3.connect(self.db_path) as conn:
            total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        cached_count = len(list(self.cache_dir.glob("*.*")))
        with self._lock:
            self._stats.update(total_cards=total, cached=cached_count)

    def stop(self):
        with self._lock:
            self._running = False
            self._active = False
        self._wake_event.set()

    # ── 主循环 ──────────────────────────────────────────────

    def run(self):
        info("爬虫线程启动", mode=self._mode)
        with self._lock:
            if self._mode == "on":
                self._active = True

        while self._running:
            mode: str
            active: bool
            with self._lock:
                mode = self._mode
                active = self._active

            if mode == "off" or not active:
                self._wake_event.wait(timeout=30)
                self._wake_event.clear()
                continue

            if mode == "scheduled":
                self._wait_3am()

            try:
                self._crawl()
            except Exception as exc:
                error("爬虫异常", err=str(exc))
                time.sleep(30)

            if mode == "scheduled":
                self._active = False

    # ── 内部 ────────────────────────────────────────────────

    def _load_mode(self):
        try:
            if self._mode_path.exists():
                d = json.loads(self._mode_path.read_text(encoding="utf-8"))
                self._mode = d.get("mode", "off")
        except Exception:
            self._mode = "off"

    def _save_mode(self):
        try:
            self._mode_path.parent.mkdir(parents=True, exist_ok=True)
            self._mode_path.write_text(
                json.dumps({"mode": self._mode}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

    def _wait_3am(self):
        """等待凌晨 3 点窗口（02:55 - 03:30）。"""
        now = datetime.now()
        today_3am = now.replace(hour=3, minute=0, second=0, microsecond=0)
        if now.hour < 3:
            target = today_3am
        elif now.hour == 3 and now.minute < 30:
            target = now  # 已经在窗口内，立即开始
        else:
            target = today_3am + timedelta(days=1)

        wait = (target - datetime.now()).total_seconds()
        if wait > 0 and wait < 86400:
            info(f"计划爬虫等待 {wait/3600:.1f}h 后启动")
            while wait > 0 and self._running:
                chunk = min(wait, 60)
                time.sleep(chunk)
                wait -= chunk
                with self._lock:
                    if self._mode != "scheduled":
                        return
            self._active = True

    def _crawl(self):
        import sqlite3

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
        cached_count = len(list(self.cache_dir.glob("*.*")))

        with self._lock:
            self._stats.update(total_cards=total, cached=cached_count, running=True)

        pending = 0

        # 优先处理新导入的卡牌
        priority: list[tuple[int, str, str, str]] = []
        with self._lock:
            if self._priority_queue:
                priority = list(self._priority_queue)
                self._priority_queue.clear()
        if priority:
            info(f"优先下载 {len(priority)} 张新导入卡牌")
            for cid, name, pc, cc in priority:
                with self._lock:
                    if not self._active or not self._running:
                        break
                key = self._key(name, pc, cc)
                if self._cached(key):
                    continue
                with self._lock:
                    self._stats["current_card"] = name
                if self._fetch_one(key, name, pc, cc):
                    pending += 1
                    if pending % 10 == 0:
                        info(f"新卡进度 {pending}/{len(priority)}")
                time.sleep(INTERVAL)

        # 常规全表扫描（已缓存的跳过）
        rows = conn.execute(
            "SELECT id, product_code, card_code, card_name "
            "FROM cards ORDER BY product_code ASC, id ASC"
        ).fetchall()
        conn.close()

        for row in rows:
            with self._lock:
                if not self._active or not self._running:
                    break

            name, pc, cc = row["card_name"], row["product_code"], row["card_code"]
            key = self._key(name, pc, cc)

            if self._cached(key):
                continue

            pending += 1
            with self._lock:
                self._stats["current_card"] = name
                self._stats["cached"] = cached_count + self._stats["zh_downloaded"] + self._stats["en_downloaded"]

            if pending % 50 == 0:
                info(f"爬虫进度 {cached_count + self._stats['zh_downloaded'] + self._stats['en_downloaded']}/{total}  简中{self._stats['zh_downloaded']}  英文{self._stats['en_downloaded']}  跳过{self._stats['skipped']}")

            if self._fetch_one(key, name, pc, cc):
                continue

            with self._lock: self._stats["skipped"] += 1
            time.sleep(INTERVAL)

        with self._lock:
            self._stats["running"] = False
        if pending == 0:
            info(f"爬虫本轮完成 ({cached_count}/{total})")
        else:
            info(f"爬虫本轮完成 (本次下载 {pending} 张, {self._stats['cached']}/{total} 已缓存)")
        time.sleep(15)

    def _key(self, name, pc, cc):
        return hashlib.sha256(f"{name}|{pc}|{cc}".encode()).hexdigest()[:16]

    def _cached(self, key):
        for ext in (".jpg", ".png", ".webp"):
            if (self.cache_dir / f"{key}{ext}").exists():
                return True
        return False

    def _fetch_one(self, key: str, name: str, pc: str, cc: str) -> bool:
        """下载单张卡图，返回 True 表示下载成功（包含跳过已缓存）。"""
        # 1) mikmoe
        with self._lock:
            self._stats["current_source"] = "mikmoe"
        u = fetch_mikmoe_image(name, pc, cc)
        if u and self._dl(key, u):
            with self._lock:
                self._stats["zh_downloaded"] += 1
                self._stats["cached"] += 1
            return True

        # 2) PTCG
        with self._lock:
            self._stats["current_source"] = "PTCG"
        u = self._ptcg_url(name)
        if u and self._dl(key, u):
            with self._lock:
                self._stats["en_downloaded"] += 1
                self._stats["cached"] += 1
            return True

        return False

    def _dl(self, key, url):
        try:
            r = requests.get(url, timeout=TIMEOUT,
                            headers={"User-Agent": "ptcg-gallery/1.0"})
            r.raise_for_status()
            ct = r.headers.get("Content-Type", "")
            ext = ".jpg"
            if "png" in ct: ext = ".png"
            elif "webp" in ct: ext = ".webp"
            (self.cache_dir / f"{key}{ext}").write_bytes(r.content)
            return True
        except Exception as e:
            debug("下载失败", url=url[:80], err=str(e))
            return False

    def _ptcg_url(self, name):
        en = translate_card_name(name.strip())
        if not en:
            return None
        try:
            r = requests.get(f"{PTCG_API}/cards",
                            params={"q": f'name:"{en}"', "pageSize": 3},
                            timeout=TIMEOUT)
            r.raise_for_status()
            for c in r.json().get("data", []):
                img = (c.get("images") or {}).get("large") or (c.get("images") or {}).get("small")
                if img:
                    return img
        except Exception:
            pass
        return None

    def verify_all_images(self) -> dict[str, Any]:
        """全量异步检查所有缓存图片。返回状态表示已启动。"""
        with self._lock:
            if self._stats.get("verify_running"):
                return {"ok": False, "error": "已有验证任务在运行中"}
            self._stats["verify_running"] = True
            self._stats["verify_total"] = 0
            self._stats["verify_verified"] = 0
            self._stats["verify_missing"] = 0
            self._stats["verify_removed"] = 0
            self._stats["verify_errors"] = 0
            self._stats["verify_current_pc"] = ""

        t = threading.Thread(target=self._verify_all_worker, daemon=True, name="img-verify-all")
        t.start()
        return {"ok": True, "message": "全量验证已启动"}

    def _verify_all_worker(self):
        import sqlite3
        conn = sqlite3.connect(self.db_path)
        pcs = [r[0] for r in conn.execute(
            "SELECT DISTINCT product_code FROM cards ORDER BY product_code"
        ).fetchall()]
        conn.close()

        url_size_cache: dict[str, int] = {}
        total = 0
        verified = 0
        missing = 0
        removed = 0
        errors = 0

        for pc in pcs:
            with self._lock:
                self._stats["verify_current_pc"] = pc

            import sqlite3 as _s
            conn2 = _s.connect(self.db_path)
            rows = conn2.execute(
                "SELECT card_name, product_code, card_code FROM cards WHERE product_code=?",
                (pc,)
            ).fetchall()
            conn2.close()

            for name, pc_val, cc in rows:
                key = self._key(name, pc_val, cc)
                total += 1

                cached = None
                for ext in (".jpg", ".png", ".webp"):
                    p = self.cache_dir / f"{key}{ext}"
                    if p.exists():
                        cached = p
                        break

                if not cached:
                    missing += 1
                    continue

                url = fetch_mikmoe_image(name, pc_val, cc)
                if not url:
                    continue

                verified += 1
                if url not in url_size_cache:
                    try:
                        r = requests.head(url, timeout=TIMEOUT)
                        url_size_cache[url] = int(r.headers.get("Content-Length", "0"))
                    except Exception:
                        errors += 1
                        continue
                expected = url_size_cache[url]

                if expected and cached.stat().st_size != expected:
                    cached.unlink()
                    removed += 1

            with self._lock:
                self._stats["verify_total"] = total
                self._stats["verify_verified"] = verified
                self._stats["verify_missing"] = missing
                self._stats["verify_removed"] = removed
                self._stats["verify_errors"] = errors

        with self._lock:
            self._stats["verify_running"] = False
            self._stats["verify_current_pc"] = ""

        info("全量图片验证完成",
             total=total, verified=verified,
             missing=missing, removed=removed, errors=errors)

        self._add_verify_history({
            "type": "all",
            "productCode": "*",
            "total": total,
            "verified": verified,
            "missing": missing,
            "removed": removed,
            "errors": errors,
        })

    def verify_product_images(self, product_code: str) -> dict[str, Any]:
        """检查指定产品的所有缓存图片是否正确。

        逐个对比缓存文件与 mikmoe 源图大小，不匹配的自动删除。
        返回统计信息。
        """
        import sqlite3

        conn = sqlite3.connect(self.db_path)
        rows = conn.execute(
            "SELECT card_name, product_code, card_code FROM cards WHERE product_code=?",
            (product_code,)
        ).fetchall()
        conn.close()

        if not rows:
            return {"ok": False, "error": f"产品 {product_code} 不存在或无卡牌"}

        url_size_cache: dict[str, int] = {}
        total = 0
        verified = 0
        missing = 0
        removed = 0
        errors = 0

        for name, pc, cc in rows:
            key = self._key(name, pc, cc)
            total += 1

            cached = None
            for ext in (".jpg", ".png", ".webp"):
                p = self.cache_dir / f"{key}{ext}"
                if p.exists():
                    cached = p
                    break

            if not cached:
                missing += 1
                continue

            url = fetch_mikmoe_image(name, pc, cc)
            if not url:
                continue

            verified += 1
            if url not in url_size_cache:
                try:
                    r = requests.head(url, timeout=TIMEOUT)
                    url_size_cache[url] = int(r.headers.get("Content-Length", "0"))
                except Exception:
                    errors += 1
                    continue
            expected = url_size_cache[url]

            if expected and cached.stat().st_size != expected:
                cached.unlink()
                removed += 1

        result = {
            "ok": True,
            "productCode": product_code,
            "total": total,
            "verified": verified,
            "missing": missing,
            "removed": removed,
            "errors": errors,
        }
        info("产品图片验证完成", **{k: v for k, v in result.items() if k != "ok"})

        self._add_verify_history({
            "type": "product",
            "productCode": product_code,
            "total": total,
            "verified": verified,
            "missing": missing,
            "removed": removed,
            "errors": errors,
        })

        return result

    def _add_verify_history(self, entry: dict[str, Any]):
        entry["time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock:
            self._verify_history.insert(0, entry)
            if len(self._verify_history) > 3:
                self._verify_history = self._verify_history[:3]

    def verify_history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._verify_history)
