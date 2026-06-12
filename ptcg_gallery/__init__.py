from __future__ import annotations

import io
import json
import tempfile
from pathlib import Path
from typing import Any

import os

from flask import Flask, Response, jsonify, redirect, render_template, request, send_file, session, url_for

from .crawler import CardCrawler
from .image_service import ImageService, source_ptcg_api
from .mikmoe_source import fetch_mikmoe_image
from .services import (
    AppPaths,
    CardRepository,
    ConflictError,
    NotFoundError,
    ServiceError,
    build_paths,
    dumps_state,
    normalize_text,
)


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    root_dir = Path((test_config or {}).get("ROOT_DIR") or Path(__file__).resolve().parent.parent)
    paths: AppPaths = build_paths(root_dir)
    app = Flask(
        __name__,
        template_folder=str(Path(__file__).resolve().parent / "templates"),
        static_folder=str(Path(__file__).resolve().parent / "static"),
    )
    app.config.update(
        ROOT_DIR=str(paths.root_dir),
        DATA_DIR=str(paths.data_dir),
        DATABASE=str(paths.db_path),
        DEFAULT_EXCEL_PATH=str(paths.default_excel_path),
        HOST="127.0.0.1",
        PORT=8000,
        TESTING=False,
        SECRET_KEY=os.environ.get("PTCG_SECRET_KEY", os.urandom(24).hex()),
    )
    # 登录凭证（默认 admin / pika2024，可通过环境变量覆盖）
    app.config["AUTH_USERNAME"] = os.environ.get("PTCG_AUTH_USER", "Flareon")
    app.config["AUTH_PASSWORD"] = os.environ.get("PTCG_AUTH_PASS", "mushroom")
    if test_config:
        app.config.update(test_config)
        if test_config.get("DATABASE"):
            paths = build_paths(app.config["ROOT_DIR"])
            paths = AppPaths(paths.root_dir, paths.data_dir, Path(app.config["DATABASE"]), paths.default_excel_path)
        if test_config.get("DEFAULT_EXCEL_PATH"):
            paths = AppPaths(paths.root_dir, paths.data_dir, paths.db_path, Path(app.config["DEFAULT_EXCEL_PATH"]))

    database_exists = Path(app.config["DATABASE"]).exists()
    repository = CardRepository(app.config["DATABASE"])
    if not database_exists:
        repository.ensure_default_decks()
    repository.ensure_default_catalog(app.config["DEFAULT_EXCEL_PATH"])
    app.config["REPOSITORY"] = repository

    image_service = ImageService(paths.data_dir)
    image_service.add_source(fetch_mikmoe_image, first=True)  # mikmoe 简中卡图（最高优先级）
    image_service.add_source(source_ptcg_api)  # PTCG API 英文卡图兜底
    app.config["IMAGE_SERVICE"] = image_service

    # 后台卡图爬虫（非测试模式下启动线程，默认模式 off=仅本地图片）
    crawler = None
    if not app.config.get("TESTING"):
        crawler = CardCrawler(app.config["DATABASE"], Path(app.config["DATA_DIR"]) / "card_images")
        crawler.start()
        # 启动时同步 ImageService 下载开关与爬虫持久化模式
        persisted_mode = crawler.stats().get("mode", "off")
        if persisted_mode == "off":
            image_service.disable_download()
    app.config["CRAWLER"] = crawler

    def create_import_backup(reason: str) -> dict[str, str]:
        payload = repository.export_state()
        timestamp = payload["exportedAt"].replace(":", "").replace("-", "").replace("Z", "")
        safe_reason = "".join(ch for ch in reason if ch.isalnum() or ch in {"-", "_"}) or "import"
        backup_dir = Path(app.config["DATA_DIR"]) / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"ptcg-gallery-state-before-{safe_reason}-{timestamp}.json"
        backup_path.write_text(dumps_state(payload), encoding="utf-8")
        return {"autoBackupPath": str(backup_path.relative_to(Path(app.config["ROOT_DIR"]))).replace("\\", "/")}

    @app.before_request
    def _require_login():
        """除登录页、静态文件和 health 外，统一要求登录。"""
        if request.endpoint in ("login_page", "login_post", "static", "health"):
            return None
        if not session.get("authed"):
            # 对 API 请求返回 401，对页面请求重定向到登录页
            if request.path.startswith("/api/"):
                return jsonify({"error": "未登录"}), 401
            return redirect(url_for("login_page", next=request.full_path))
        return None

    @app.get("/login")
    def login_page():
        return render_template("login.html")

    @app.post("/login")
    def login_post():
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        if username == app.config["AUTH_USERNAME"] and password == app.config["AUTH_PASSWORD"]:
            session["authed"] = True
            session["authed_user"] = username
            next_url = request.args.get("next", "/")
            # 防止 open redirect
            if not next_url.startswith("/"):
                next_url = "/"
            return redirect(next_url)
        return render_template("login.html", error="用户名或密码错误"), 401

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login_page"))

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/holdings")
    def holdings_page():
        return render_template("holdings.html")

    @app.get("/inventory-table")
    def inventory_table_page():
        return render_template("inventory_table.html")

    @app.get("/decks")
    def decks_page():
        return render_template("decks.html")

    @app.get("/decks/<int:deck_id>")
    def deck_detail_page(deck_id: int):
        return render_template("deck_detail.html", deck_id=deck_id)

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "stats": repository.stats()})

    @app.get("/api/summary")
    def summary():
        return jsonify(repository.stats())

    @app.get("/api/accounts")
    def list_accounts():
        return jsonify(repository.list_accounts())

    @app.post("/api/accounts")
    def create_account():
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.create_account(payload.get("name", ""))), 201

    @app.put("/api/accounts/current")
    def switch_account():
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.switch_account(int(payload.get("accountId", 0) or 0)))

    @app.delete("/api/accounts/<int:account_id>")
    def delete_account(account_id: int):
        return jsonify(repository.delete_account(account_id))

    @app.get("/api/holdings")
    def holdings():
        return jsonify(repository.holdings_report())

    @app.put("/api/inventory-table/group-quantities")
    def update_inventory_table_group_quantities():
        payload = request.get_json(force=True, silent=True) or {}
        result = repository.update_inventory_table_group_quantities(
            payload.get("groupKey", ""),
            payload.get("cards", []),
        )
        return jsonify(result)

    @app.put("/api/inventory-table/group-order")
    def update_inventory_table_group_order():
        payload = request.get_json(force=True, silent=True) or {}
        result = repository.reorder_inventory_table_groups(
            payload.get("sectionKey", ""),
            payload.get("groupKeys", []),
        )
        return jsonify(result)

    @app.get("/api/decks")
    def list_decks():
        return jsonify({"items": repository.list_decks()})

    @app.post("/api/decks")
    def create_deck():
        payload = request.get_json(force=True, silent=True) or {}
        deck = repository.create_deck(payload.get("name", ""), payload.get("description", ""), payload.get("color", ""))
        return jsonify(deck), 201

    @app.get("/api/decks/<int:deck_id>")
    def get_deck(deck_id: int):
        return jsonify(repository.get_deck_detail(deck_id))

    @app.put("/api/decks/<int:deck_id>/basic-energies")
    def update_deck_basic_energies(deck_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.update_deck_basic_energies(deck_id, payload.get("items", [])))

    @app.put("/api/decks/<int:deck_id>/cards/<int:card_id>/backup-quantity")
    def update_deck_backup_quantity(deck_id: int, card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.update_deck_backup_quantity(deck_id, card_id, payload.get("quantity", 0)))

    @app.put("/api/decks/<int:deck_id>/group-order")
    def reorder_deck_detail_group(deck_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.reorder_deck_detail_group(deck_id, payload.get("groupKey", ""), payload.get("cardIds", [])))

    @app.put("/api/decks/<int:deck_id>/section-order")
    def reorder_deck_detail_section(deck_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.reorder_deck_detail_section(deck_id, payload.get("sectionKey", ""), payload.get("entryKeys", [])))

    @app.post("/api/decks/<int:deck_id>/cards/<int:card_id>/quantity-action")
    def apply_deck_card_quantity_action(deck_id: int, card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(
            repository.apply_deck_card_quantity_action(
                deck_id,
                card_id,
                payload.get("entryType", ""),
                payload.get("mode", ""),
                payload.get("targetQuantity", 0),
            )
        )

    @app.put("/api/decks/<int:deck_id>")
    def update_deck(deck_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        deck = repository.update_deck(deck_id, payload.get("name", ""), payload.get("description", ""), payload.get("color", ""))
        return jsonify(deck)

    @app.delete("/api/decks/<int:deck_id>")
    def delete_deck(deck_id: int):
        repository.delete_deck(deck_id)
        return Response(status=204)

    @app.post("/api/decks/reorder")
    def reorder_decks():
        payload = request.get_json(force=True, silent=True) or {}
        deck_ids = payload.get("deckIds", [])
        if not isinstance(deck_ids, list):
            raise ServiceError("卡组顺序格式不正确")
        return jsonify({"items": repository.reorder_decks(deck_ids)})

    @app.get("/api/search/options")
    def get_search_options():
        return jsonify(
            {
                "regulations": repository.list_search_regulations(),
                "preferences": repository.get_search_preferences(),
            }
        )

    @app.put("/api/search/preferences")
    def update_search_preferences():
        payload = request.get_json(force=True, silent=True) or {}
        selected_regulations = payload.get("selectedRegulations", [])
        if not isinstance(selected_regulations, list):
            raise ServiceError("赛制筛选格式不正确")
        return jsonify(
            repository.update_search_preferences(
                selected_regulations,
                bool(payload.get("considerSameNameRegulation", False)),
            )
        )

    @app.get("/api/search")
    def search_cards():
        query = request.args.get("q", "")
        regulations = request.args.getlist("regulation")
        consider_same_name_regulation = normalize_text(request.args.get("considerSameNameRegulation", "")).lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        return jsonify(
            {
                "items": repository.search_cards(
                    query,
                    regulations=regulations,
                    consider_same_name_regulation=consider_same_name_regulation,
                )
            }
        )

    @app.get("/api/cards/<int:card_id>")
    def get_card(card_id: int):
        return jsonify(repository.get_card(card_id))

    @app.post("/api/cards/<int:card_id>/free-adjust")
    def adjust_free(card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        card = repository.adjust_free_inventory(card_id, int(payload.get("delta", 0)))
        return jsonify(card)

    @app.put("/api/cards/<int:card_id>/free-quantity")
    def set_free_quantity(card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        return jsonify(repository.set_free_inventory_quantity(card_id, payload.get("quantity", 0)))

    @app.post("/api/cards/<int:card_id>/add-to-deck")
    def add_to_deck(card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        card = repository.add_to_deck(
            card_id,
            int(payload.get("deckId", 0)),
            int(payload.get("amount", 0)),
            consume_free=bool(payload.get("consumeFree", False)),
        )
        return jsonify(card)

    @app.post("/api/cards/<int:card_id>/remove-from-deck")
    def remove_from_deck(card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        card = repository.remove_from_deck(
            card_id,
            int(payload.get("deckId", 0)),
            int(payload.get("amount", 0)),
            back_to_free=bool(payload.get("backToFree", False)),
        )
        return jsonify(card)

    @app.post("/api/cards/<int:card_id>/adjust-total")
    def adjust_total(card_id: int):
        payload = request.get_json(force=True, silent=True) or {}
        card = repository.adjust_total_quantity(card_id, int(payload.get("delta", 0)))
        return jsonify(card)

    @app.delete("/api/cards/<int:card_id>")
    def delete_card(card_id: int):
        repository.delete_card(card_id)
        return Response(status=204)

    @app.post("/api/import/catalog-default")
    def import_catalog_default():
        backup = create_import_backup("catalog-default")
        result = repository.import_catalog_from_excel(app.config["DEFAULT_EXCEL_PATH"])
        return jsonify(result | backup)

    @app.post("/api/import/catalog-upload")
    def import_catalog_upload():
        upload = request.files.get("file")
        if upload is None or upload.filename == "":
            raise ServiceError("请选择一个 .xlsx 文件")
        backup = create_import_backup("catalog-upload")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as temp_file:
            upload.save(temp_file.name)
            temp_path = temp_file.name
        try:
            result = repository.import_catalog_from_excel(temp_path)
        finally:
            Path(temp_path).unlink(missing_ok=True)
        return jsonify(result | backup)

    @app.get("/api/export/state")
    def export_state():
        payload = repository.export_state()
        buffer = io.BytesIO(dumps_state(payload).encode("utf-8"))
        buffer.seek(0)
        return send_file(
            buffer,
            as_attachment=True,
            download_name="ptcg-gallery-state.json",
            mimetype="application/json",
        )

    @app.post("/api/import/state")
    def import_state():
        upload = request.files.get("file")
        if upload is None or upload.filename == "":
            raise ServiceError("请选择一个状态文件")
        backup = create_import_backup("state")
        try:
            payload = json.loads(upload.stream.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError("状态文件不是有效的 UTF-8 JSON") from exc
        result = repository.import_state(payload)
        return jsonify(result | backup)

    # ── 纯库存导出/导入 ────────────────────────────────────

    @app.get("/api/export/inventory")
    def export_inventory():
        payload = repository.export_inventory()
        buffer = io.BytesIO(dumps_state(payload).encode("utf-8"))
        buffer.seek(0)
        return send_file(
            buffer,
            as_attachment=True,
            download_name="ptcg-gallery-inventory.json",
            mimetype="application/json",
        )

    @app.post("/api/import/inventory")
    def import_inventory():
        upload = request.files.get("file")
        if upload is None or upload.filename == "":
            raise ServiceError("请选择一个库存文件")
        backup = create_import_backup("inventory")
        try:
            payload = json.loads(upload.stream.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError("库存文件不是有效的 UTF-8 JSON") from exc
        result = repository.import_inventory(payload)
        return jsonify(result | backup)

    @app.get("/api/images/<cache_key>")
    def serve_card_image(cache_key: str):
        """提供本地缓存的卡牌图片文件。"""
        image_path = image_service.get_cached_image_path(cache_key)
        if not image_path:
            return Response(status=404)
        return send_file(image_path)

    @app.get("/api/images/lookup")
    def lookup_card_image():
        """查询卡牌图片并返回本地缓存 URL。

        查询参数：name (必填), productCode (可选), cardCode (可选)
        返回：{ url: "/api/images/xxx" } 或 { url: null }
        """
        card_name = request.args.get("name", "").strip()
        if not card_name:
            return jsonify({"url": None})
        product_code = request.args.get("productCode", "").strip()
        card_code = request.args.get("cardCode", "").strip()
        url = image_service.get_image_url(card_name, product_code, card_code)
        return jsonify({"url": url})

    @app.get("/api/images/user/<filename>")
    def serve_user_image(filename: str):
        """提供用户手动放入的简中卡牌图片文件。"""
        user_dir = Path(app.config["DATA_DIR"]) / "card_images_user"
        safe_name = Path(filename).name
        image_path = user_dir / safe_name
        if not image_path.exists() or not image_path.is_file():
            return Response(status=404)
        return send_file(image_path)

    # ── 爬虫管理 ────────────────────────────────────────────

    @app.get("/api/crawler/status")
    def crawler_status():
        if crawler is None:
            return jsonify({"running": False, "mode": "off", "downloadEnabled": False,
                           "reason": "未启动（测试模式）"})
        stats = crawler.stats()
        stats["downloadEnabled"] = image_service.is_download_enabled()
        return jsonify(stats)

    @app.put("/api/crawler/mode")
    def crawler_set_mode():
        if crawler is None:
            return jsonify({"ok": False, "error": "爬虫未启动"}), 400
        payload = request.get_json(force=True, silent=True) or {}
        mode = payload.get("mode", "").strip().lower()
        if mode not in ("off", "on", "scheduled", "demand"):
            return jsonify({"ok": False, "error": "模式只能为 off / demand / on / scheduled"}), 400
        try:
            crawler.set_mode(mode)
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        # off → 同时关闭按需下载
        if mode == "off":
            image_service.disable_download()
        else:
            image_service.enable_download()
        return jsonify({"ok": True, "mode": mode, "downloadEnabled": image_service.is_download_enabled()})

    @app.errorhandler(ServiceError)
    @app.errorhandler(NotFoundError)
    @app.errorhandler(ConflictError)
    def handle_service_error(error: Exception):
        status = 400
        if isinstance(error, NotFoundError):
            status = 404
        elif isinstance(error, ConflictError):
            status = 409
        return jsonify({"error": str(error)}), status

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception):
        if app.config.get("TESTING"):
            raise error
        return jsonify({"error": f"服务器内部错误：{error}"}), 500

    return app

