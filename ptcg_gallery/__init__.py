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
    DEFAULT_ACCOUNT_NAME,
    NotFoundError,
    ServiceError,
    build_paths,
    dumps_state,
    normalize_text,
)


def _load_session_account(repository: CardRepository) -> dict[str, Any] | None:
    account_id = int(session.get("account_id", 0) or 0)
    account_name = normalize_text(session.get("account_name", ""))
    if account_id <= 0 or not account_name:
        return None
    account = repository.get_account_by_name(account_name)
    if account is None or int(account.get("id", 0) or 0) != account_id:
        return None
    return account


def _load_request_account(repository: CardRepository) -> dict[str, Any] | None:
    account = _load_session_account(repository)
    if account is not None:
        return account
    try:
        with repository.connect_catalog() as conn:
            account_id = repository.get_current_account_id(conn)
            row = conn.execute("SELECT id, name FROM accounts WHERE id = ?", (account_id,)).fetchone()
    except Exception:
        return None
    return dict(row) if row is not None else None


def _is_request_admin(repository: CardRepository) -> bool:
    if bool(session.get("is_admin")):
        return True
    account = _load_request_account(repository)
    if account is None:
        return False
    return normalize_text(account.get("name", "")) == normalize_text(DEFAULT_ACCOUNT_NAME)


def _load_auth_config(data_dir: str, test_config: dict[str, Any] | None = None) -> dict[str, str]:
    """从 data/auth.json 读取管理员凭据。测试模式下可通过 test_config 注入。"""
    if test_config:
        return {
            "admin_user": test_config.get("AUTH_USERNAME", ""),
            "admin_pass": test_config.get("AUTH_PASSWORD", ""),
            "init_admin_pass": test_config.get("INIT_ADMIN_PASS", test_config.get("AUTH_PASSWORD", "")),
        }
    auth_file = Path(data_dir) / "auth.json"
    if not auth_file.exists():
        raise SystemExit(
            f"缺少认证配置文件 {auth_file}\n"
            f"请创建该文件，内容格式：\n"
            f'  {{"admin_user": "你的管理员用户名", "admin_pass": "你的管理员密码", "init_admin_pass": "RhymesX初始密码"}}\n'
        )
    try:
        data = json.loads(auth_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"认证配置文件 {auth_file} 不是有效的 JSON: {exc}") from exc
    admin_user = str(data.get("admin_user", "")).strip()
    admin_pass = str(data.get("admin_pass", "")).strip()
    init_admin_pass = str(data.get("init_admin_pass", "")).strip()
    if not admin_user or not admin_pass:
        raise SystemExit(f"认证配置文件 {auth_file} 缺少 admin_user 或 admin_pass 字段")
    if not init_admin_pass:
        raise SystemExit(f"认证配置文件 {auth_file} 缺少 init_admin_pass 字段")
    return {"admin_user": admin_user, "admin_pass": admin_pass, "init_admin_pass": init_admin_pass}


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
    auth = _load_auth_config(str(paths.data_dir), test_config)
    app.config["AUTH_USERNAME"] = auth["admin_user"]
    app.config["AUTH_PASSWORD"] = auth["admin_pass"]
    app.config["INIT_ADMIN_PASS"] = auth["init_admin_pass"]
    if test_config:
        app.config.update(test_config)
        if test_config.get("DATABASE"):
            paths = build_paths(app.config["ROOT_DIR"])
            paths = AppPaths(paths.root_dir, paths.data_dir, Path(app.config["DATABASE"]), paths.accounts_dir, paths.default_excel_path)
        if test_config.get("DEFAULT_EXCEL_PATH"):
            paths = AppPaths(paths.root_dir, paths.data_dir, paths.db_path, paths.accounts_dir, Path(app.config["DEFAULT_EXCEL_PATH"]))

    from .wx_auth import init_jwt_secret

    init_jwt_secret(app.config["SECRET_KEY"])

    database_exists = Path(app.config["DATABASE"]).exists()
    repository = CardRepository(app.config["DATABASE"], accounts_dir=paths.accounts_dir)
    repository.set_init_admin_pass(app.config["INIT_ADMIN_PASS"])
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

    def _notify_crawler_after_import(result: dict[str, Any]):
        """导入完成后通知爬虫：刷新统计 + 优先下载新卡。"""
        if crawler is None:
            return
        new_cards = result.pop("_new_cards", None) or []
        if new_cards:
            crawler.notify_new_cards(new_cards)
        crawler.refresh_stats()

    @app.before_request
    def _require_login():
        """除登录页、静态文件和 health 外，统一要求登录。支持 session cookie 和 JWT Bearer token 两种方式。"""
        if request.endpoint in ("login_page", "login_post", "register_account", "wx_login", "wx_bind", "serve_card_image", "serve_user_image", "static", "health"):
            repository.clear_request_account_id()
            return None

        # Path 1: Flask session cookie（Web 端）
        account = _load_session_account(repository)
        if account is not None:
            repository.set_request_account_id(int(account["id"]))
            return None

        # Path 2: JWT Bearer token（微信小程序）
        from .wx_auth import verify_jwt

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            payload = verify_jwt(token)
            if payload is not None:
                account_id = int(payload["sub"])
                with repository.connect_catalog() as conn:
                    row = conn.execute("SELECT id, name FROM accounts WHERE id = ?", (account_id,)).fetchone()
                if row is not None:
                    session["is_admin"] = normalize_text(row["name"]) == normalize_text(DEFAULT_ACCOUNT_NAME)
                    repository.set_request_account_id(account_id)
                    return None

        repository.clear_request_account_id()
        session.pop("is_admin", None)
        # 对 API 请求返回 401，对页面请求重定向到登录页
        if request.path.startswith("/api/"):
            return jsonify({"error": "未登录"}), 401
        return redirect(url_for("login_page", next=request.full_path))

    @app.teardown_request
    def _clear_request_account(_exc: BaseException | None):
        repository.clear_request_account_id()

    @app.context_processor
    def _inject_admin_flag():
        return {"is_admin": bool(session.get("is_admin"))}

    @app.get("/login")
    def login_page():
        return render_template("login.html")

    @app.post("/login")
    def login_post():
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        account: dict[str, Any] | None = None
        is_admin = username == app.config["AUTH_USERNAME"] and password == app.config["AUTH_PASSWORD"]
        if is_admin:
            account = repository.get_account_by_name("RhymesX")
        else:
            account = repository.verify_account_credentials(username, password)
        if account is not None:
            session["account_id"] = int(account["id"])
            session["account_name"] = account["name"]
            session["is_admin"] = is_admin
            next_url = request.args.get("next", "/")
            # 防止 open redirect
            if not next_url.startswith("/"):
                next_url = "/"
            return redirect(next_url)
        return render_template("login.html", error="用户名或密码错误"), 401

    @app.post("/logout")
    def logout():
        repository.clear_request_account_id()
        session.clear()
        return redirect(url_for("login_page"))

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/admin")
    def admin_page():
        if not session.get("is_admin"):
            return redirect("/")
        return render_template("admin.html")

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

    @app.get("/api/settings/registration")
    def get_registration_settings():
        """获取注册相关设置（无需登录，供注册页面查询是否需要邀请码）。"""
        return jsonify({"requireInvite": repository.is_invite_required()})

    @app.put("/api/settings/registration")
    def set_registration_settings():
        """管理员设置注册邀请码开关。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        payload = request.get_json(force=True, silent=True) or {}
        require_invite = bool(payload.get("requireInvite", True))
        repository.set_invite_required(require_invite)
        return jsonify({"requireInvite": repository.is_invite_required()})

    @app.get("/api/accounts")
    def list_accounts():
        account = _load_request_account(repository)
        payload = repository.list_accounts()
        return jsonify(payload | {"current": account, "isAdmin": bool(session.get("is_admin"))})

    @app.post("/api/accounts")
    def register_account():
        """注册新账号（根据全局开关决定是否需要邀请码）。"""
        payload = request.get_json(force=True, silent=True) or {}
        name = (payload.get("name") or "").strip()
        password = (payload.get("password") or "").strip()
        invite_code = (payload.get("inviteCode") or "").strip()
        if not name:
            return jsonify({"error": "账号名称不能为空"}), 400
        if not password or len(password) < 4:
            return jsonify({"error": "密码至少需要 4 位"}), 400

        require_invite = repository.is_invite_required()
        if require_invite:
            if not invite_code:
                return jsonify({"error": "需要邀请码才能注册"}), 400

        result = repository.create_account(name, password)
        account = repository.get_account_by_name(name)
        if account is None:
            return jsonify({"error": "注册失败"}), 500

        if require_invite:
            if not repository.validate_invite_code(invite_code):
                with repository.connect() as conn:
                    conn.execute("DELETE FROM accounts WHERE id = ?", (int(account["id"]),))
                return jsonify({"error": "邀请码无效或已过期"}), 400
            repository.consume_invite_code(invite_code, int(account["id"]))

        return jsonify(result), 201

    @app.post("/api/wx/login")
    def wx_login():
        """微信小程序登录：已绑定→返回JWT，未绑定→根据邀请码开关决定自动创建还是要求输入邀请码。"""
        payload = request.get_json(force=True, silent=True) or {}
        code = (payload.get("code") or "").strip()
        if not code:
            return jsonify({"error": "缺少登录凭证 code"}), 400

        from .wx_auth import create_jwt, decode_wechat_code

        try:
            wx_data = decode_wechat_code(code)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 400

        openid = wx_data["openid"]
        account = repository.get_account_by_wx_openid(openid)
        if account is not None:
            account_id = int(account["id"])
            account_name = account["name"]
            token = create_jwt(account_id, account_name)
            return jsonify({
                "token": token,
                "accountId": account_id,
                "accountName": account_name,
                "isAdmin": normalize_text(account_name) == normalize_text(DEFAULT_ACCOUNT_NAME),
            })

        # 未绑定账号
        invite_code = (payload.get("inviteCode") or "").strip()

        if not repository.is_invite_required():
            # 开关关闭，自动创建账号
            account_name = f"微信用户{openid[-6:]}"
            result = repository.create_wechat_account(account_name, openid)
            token = create_jwt(result["id"], result["name"])
            return jsonify({
                "token": token,
                "accountId": result["id"],
                "accountName": result["name"],
                "isAdmin": normalize_text(result["name"]) == normalize_text(DEFAULT_ACCOUNT_NAME),
            })

        # 开关打开，需要邀请码
        if not invite_code:
            return jsonify({"needInvite": True, "openid": openid})

        if not repository.validate_invite_code(invite_code):
            return jsonify({"error": "邀请码无效或已过期"}), 400

        account_name = f"微信用户{openid[-6:]}"
        result = repository.create_wechat_account(account_name, openid)
        repository.consume_invite_code(invite_code, result["id"])
        token = create_jwt(result["id"], result["name"])
        return jsonify({
            "token": token,
            "accountId": result["id"],
            "accountName": result["name"],
            "isAdmin": normalize_text(result["name"]) == normalize_text(DEFAULT_ACCOUNT_NAME),
        })

    @app.post("/api/wx/bind")
    def wx_bind():
        """小程序端提交绑定码，将 openid 绑定到已有账号，返回 JWT。"""
        payload = request.get_json(force=True, silent=True) or {}
        bind_code = (payload.get("code") or "").strip()
        openid = (payload.get("openid") or "").strip()
        if not bind_code:
            return jsonify({"error": "请输入绑定码"}), 400
        if not openid:
            return jsonify({"error": "缺少 openid"}), 400

        from .wx_auth import create_jwt

        account_id = repository.consume_bind_code(bind_code)
        if account_id is None:
            return jsonify({"error": "绑定码无效或已过期"}), 400

        # 检查该账号是否已绑定了其他微信号
        existing = repository.get_account_by_wx_openid(openid)
        if existing is not None:
            return jsonify({"error": "该微信已绑定过账号"}), 409

        repository.bind_wx_openid(account_id, openid)
        account = repository.get_account_by_wx_openid(openid)
        if account is None:
            return jsonify({"error": "绑定失败"}), 500

        token = create_jwt(int(account["id"]), account["name"])
        return jsonify({
            "token": token,
            "accountId": int(account["id"]),
            "accountName": account["name"],
            "isAdmin": normalize_text(account["name"]) == normalize_text(DEFAULT_ACCOUNT_NAME),
        })

    @app.post("/api/account/bind-code")
    def create_bind_code():
        """已登录 Web 用户生成一个 5 分钟有效的绑定码，供小程序端绑定使用。"""
        account = _load_session_account(repository)
        if account is None:
            return jsonify({"error": "未登录"}), 401
        try:
            code = repository.create_bind_code(int(account["id"]))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({"code": code})

    @app.put("/api/accounts/password")
    def change_account_password():
        """当前登录账号修改密码。"""
        account = _load_session_account(repository)
        if account is None:
            return jsonify({"error": "未登录"}), 401
        payload = request.get_json(force=True, silent=True) or {}
        old_password = (payload.get("oldPassword") or "").strip()
        new_password = (payload.get("newPassword") or "").strip()
        if not old_password or not new_password:
            return jsonify({"error": "原密码和新密码均不能为空"}), 400
        if len(new_password) < 4:
            return jsonify({"error": "新密码至少需要 4 位"}), 400
        repository.change_account_password(int(account["id"]), old_password, new_password)
        return jsonify({"ok": True})

    @app.put("/api/accounts/<int:account_id>/password")
    def admin_reset_account_password(account_id: int):
        """管理员直接重置任意普通账号密码。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作，仅管理员可用"}), 403
        payload = request.get_json(force=True, silent=True) or {}
        new_password = (payload.get("newPassword") or "").strip()
        if not new_password or len(new_password) < 4:
            return jsonify({"error": "新密码至少需要 4 位"}), 400
        repository.reset_account_password(account_id, new_password)
        return jsonify({"ok": True})

    @app.delete("/api/accounts/<int:account_id>")
    def admin_delete_account(account_id: int):
        """管理员删除指定账号及其所有数据。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        repository.delete_account(account_id)
        return jsonify({"ok": True})

    # ── 邀请码管理（仅管理员） ──

    @app.get("/api/invite-codes")
    def list_invite_codes():
        """管理员查看所有有效邀请码。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        return jsonify(repository.list_invite_codes())

    @app.post("/api/invite-codes")
    def generate_invite_code():
        """管理员生成新邀请码。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        payload = request.get_json(silent=True) or {}
        expires_in_days = int(payload.get("expiresInDays", 1) or 1)
        if expires_in_days <= 0:
            return jsonify({"error": "邀请码有效天数必须大于 0"}), 400
        return jsonify(repository.generate_invite_code(expires_in_days=expires_in_days))

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

    @app.post("/api/decks/<int:deck_id>/move-to-free")
    def move_deck_cards_to_free(deck_id: int):
        return jsonify(repository.move_deck_cards_to_free(deck_id))

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

    # ── 退标 ──────────────────────────────────────────────────────

    @app.get("/api/retire/preview")
    def retire_preview():
        regulation = request.args.get("regulation", "").strip()
        skip_same_name = request.args.get("skipSameName", "true").lower() != "false"
        include_deck_cards = request.args.get("includeDeckCards", "true").lower() != "false"
        full_inventory_check = request.args.get("fullInventoryCheck", "false").lower() == "true"
        if not full_inventory_check and not regulation:
            return jsonify({"regulation": "", "decks": [], "cards": [], "totalCount": 0, "totalQuantity": 0})
        preferences = repository.get_search_preferences()
        protected_regulations = preferences.get("selectedRegulations", []) if isinstance(preferences, dict) else []
        return jsonify(
            repository.preview_retire_by_regulation(
                regulation,
                skip_same_name,
                include_deck_cards,
                protected_regulations=protected_regulations,
                full_inventory_check=full_inventory_check,
            )
        )

    @app.post("/api/retire/execute")
    def retire_execute():
        payload = request.get_json(silent=True) or {}
        card_ids = [int(x) for x in (payload.get("cardIds") or [])]
        removed = repository.execute_retire_cards(card_ids)
        return jsonify({"removed": removed})

    @app.post("/api/import/catalog-default")
    def import_catalog_default():
        backup = create_import_backup("catalog-default")
        result = repository.import_catalog_from_excel(app.config["DEFAULT_EXCEL_PATH"])
        _notify_crawler_after_import(result)
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
        _notify_crawler_after_import(result)
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

    @app.post("/api/images/lookup-batch")
    def lookup_card_images_batch():
        """批量查询卡牌图片。请求体：{ cards: [{ name, productCode?, cardCode? }] }
        返回：{ urls: { "name|productCode|cardCode": "/api/images/xxx" } }
        """
        payload = request.get_json(force=True, silent=True) or {}
        cards = payload.get("cards") or []
        result = {}
        for c in cards:
            if not c or not c.get("name"):
                continue
            name = c["name"].strip()
            pc = (c.get("productCode") or "").strip()
            cc = (c.get("cardCode") or "").strip()
            key = f"{name}|{pc}|{cc}"
            url = image_service.get_image_url(name, pc, cc)
            if url:
                result[key] = url
        return jsonify({"urls": result})

    @app.get("/api/images/user/<path:filename>")
    def serve_user_image(filename: str):
        """提供用户手动放入的简中卡牌图片文件（支持子目录）。"""
        user_dir = Path(app.config["DATA_DIR"]) / "card_images_user"
        image_path = (user_dir / filename).resolve()
        # 防止路径穿越
        if not str(image_path).startswith(str(user_dir.resolve())):
            return Response(status=404)
        if not image_path.exists() or not image_path.is_file():
            return Response(status=404)
        return send_file(image_path)

    @app.post("/api/images/reload-user-index")
    def reload_user_image_index():
        """重新扫描 card_images_user/ 子目录索引。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        image_service.reload_user_index()
        return jsonify({"ok": True})

    @app.post("/api/images/verify-product")
    def verify_product_images():
        """检查指定产品的所有缓存图片是否与 mikmoe 源一致。
        不匹配的自动删除，后续爬虫会重新下载。
        请求体：{ productCode: "CSV10C" }
        """
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        if crawler is None:
            return jsonify({"error": "爬虫未启动"}), 400
        payload = request.get_json(force=True, silent=True) or {}
        pc = (payload.get("productCode") or "").strip()
        if not pc:
            return jsonify({"error": "缺少 productCode"}), 400
        result = crawler.verify_product_images(pc)
        return jsonify(result)

    @app.post("/api/images/verify-all")
    def verify_all_images():
        """全量异步检查所有缓存图片。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        if crawler is None:
            return jsonify({"error": "爬虫未启动"}), 400
        result = crawler.verify_all_images()
        return jsonify(result)

    @app.get("/api/images/verify-status")
    def verify_status():
        """获取全量验证的当前进度 + 最近3次验证历史。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        if crawler is None:
            return jsonify({"running": False, "history": []})
        stats = crawler.stats()
        return jsonify({
            "running": stats.get("verify_running", False),
            "total": stats.get("verify_total", 0),
            "verified": stats.get("verify_verified", 0),
            "missing": stats.get("verify_missing", 0),
            "removed": stats.get("verify_removed", 0),
            "errors": stats.get("verify_errors", 0),
            "currentPc": stats.get("verify_current_pc", ""),
            "history": crawler.verify_history(),
        })

    @app.get("/api/images/<path:cache_key>")
    def serve_card_image(cache_key: str):
        """提供本地缓存的卡牌图片文件。支持无后缀和带后缀两种格式。"""
        if "." in cache_key and not cache_key.startswith("user/"):
            cache_key = cache_key.rsplit(".", 1)[0]
        image_path = image_service.get_cached_image_path(cache_key)
        if not image_path:
            return Response(status=404)
        return send_file(image_path)

    # ── 爬虫管理 ────────────────────────────────────────────

    @app.get("/api/crawler/status")
    def crawler_status():
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        if crawler is None:
            return jsonify({"running": False, "mode": "off", "downloadEnabled": False,
                           "reason": "未启动（测试模式）"})
        stats = crawler.stats()
        stats["downloadEnabled"] = image_service.is_download_enabled()
        return jsonify(stats)

    @app.put("/api/crawler/mode")
    def crawler_set_mode():
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
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

    @app.post("/api/nicknames/reload")
    def reload_nicknames():
        """管理员从 Excel 重新加载昵称，无需重启服务。"""
        if not session.get("is_admin"):
            return jsonify({"error": "无权操作"}), 403
        try:
            nicknames = repository.load_nicknames_from_excel()
            if nicknames:
                repository.sync_nicknames_to_db(nicknames)
                return jsonify({"ok": True, "count": len(nicknames)})
            else:
                return jsonify({"ok": False, "error": "未找到 nicknames.xlsx 或文件中无数据"}), 400
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500

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

