from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


ACCOUNT_DB_SCHEMA_VERSION = 1
DEFAULT_DATABASE_NAME = "ptcg_gallery.db"
DEFAULT_SEARCH_PREFERENCES = {
    "selectedRegulations": [],
    "considerSameNameRegulation": False,
}
SEARCH_PREFERENCES_FILE_NAME = "search_preferences.json"
AUTH_FILE_NAME = "auth.json"

ACCOUNT_SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS free_inventory (
    card_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY(card_id)
);

CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    backup_quantity INTEGER NOT NULL DEFAULT 0 CHECK (backup_quantity >= 0),
    PRIMARY KEY(deck_id, card_id),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deck_basic_energies (
    deck_id INTEGER NOT NULL,
    energy_code TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY(deck_id, energy_code),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deck_section_orders (
    deck_id INTEGER NOT NULL,
    section_key TEXT NOT NULL,
    entry_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(deck_id, section_key, entry_key),
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS holdings_group_orders (
    section_key TEXT NOT NULL,
    group_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(section_key, group_key)
);

CREATE TABLE IF NOT EXISTS holdings_card_orders (
    card_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(card_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


@dataclass(slots=True)
class MigrationPaths:
    root_dir: Path
    data_dir: Path
    database_path: Path
    accounts_dir: Path
    backups_dir: Path
    search_preferences_path: Path
    auth_path: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect or migrate ptcgGallery from a single legacy SQLite DB to per-account DB files."
    )
    parser.add_argument(
        "--root-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory. Defaults to the repository root.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        help="Override the data directory. Defaults to <root-dir>/data.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        help="Override the legacy catalog database path. Defaults to <data-dir>/ptcg_gallery.db.",
    )
    parser.add_argument(
        "--accounts-dir",
        type=Path,
        help="Override the target per-account DB directory. Defaults to <data-dir>/accounts.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the migration. Without this flag, the script only inspects and reports.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing account DB files when applying the migration.",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        help="Optional path for the JSON report. Defaults to a timestamped file under data/backups when applying.",
    )
    return parser.parse_args()


def resolve_paths(args: argparse.Namespace) -> MigrationPaths:
    root_dir = args.root_dir.resolve()
    data_dir = args.data_dir.resolve() if args.data_dir else (root_dir / "data")
    database_path = args.database.resolve() if args.database else (data_dir / DEFAULT_DATABASE_NAME)
    accounts_dir = args.accounts_dir.resolve() if args.accounts_dir else (data_dir / "accounts")
    backups_dir = data_dir / "backups"
    search_preferences_path = data_dir / SEARCH_PREFERENCES_FILE_NAME
    auth_path = data_dir / AUTH_FILE_NAME
    return MigrationPaths(
        root_dir=root_dir,
        data_dir=data_dir,
        database_path=database_path,
        accounts_dir=accounts_dir,
        backups_dir=backups_dir,
        search_preferences_path=search_preferences_path,
        auth_path=auth_path,
    )


def configure_connection(conn: sqlite3.Connection):
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")


def connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    configure_connection(conn)
    return conn


@contextmanager
def sqlite_connection(db_path: Path):
    conn = connect_db(db_path)
    try:
        yield conn
    finally:
        conn.close()


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def sanitize_search_preferences(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return dict(DEFAULT_SEARCH_PREFERENCES)
    seen: set[str] = set()
    selected_regulations: list[str] = []
    raw_regulations = payload.get("selectedRegulations", [])
    if isinstance(raw_regulations, list):
        for item in raw_regulations:
            clean_item = normalize_text(item)
            if not clean_item or clean_item in seen:
                continue
            seen.add(clean_item)
            selected_regulations.append(clean_item)
    return {
        "selectedRegulations": selected_regulations,
        "considerSameNameRegulation": bool(payload.get("considerSameNameRegulation", False)),
    }


def load_search_preferences(search_preferences_path: Path) -> dict[str, Any]:
    if not search_preferences_path.exists():
        return dict(DEFAULT_SEARCH_PREFERENCES)
    try:
        payload = json.loads(search_preferences_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SEARCH_PREFERENCES)
    return sanitize_search_preferences(payload)


def get_table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}


def ensure_legacy_schema(conn: sqlite3.Connection):
    required_tables = {
        "accounts",
        "cards",
        "free_inventory",
        "decks",
        "deck_cards",
        "deck_basic_energies",
        "deck_section_orders",
    }
    existing_tables = {
        str(row["name"])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    missing_tables = sorted(required_tables - existing_tables)
    if missing_tables:
        raise SystemExit(f"Legacy database is missing required tables: {', '.join(missing_tables)}")

    free_inventory_columns = get_table_columns(conn, "free_inventory")
    decks_columns = get_table_columns(conn, "decks")
    if "account_id" not in free_inventory_columns:
        raise SystemExit("Legacy free_inventory table no longer has account_id; this migration script expects the pre-split schema.")
    if "account_id" not in decks_columns:
        raise SystemExit("Legacy decks table no longer has account_id; this migration script expects the pre-split schema.")


def fetch_accounts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, name, sort_order, created_at, updated_at FROM accounts ORDER BY sort_order ASC, id ASC"
    ).fetchall()


def fetch_global_group_orders(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    tables = {
        str(row["name"])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    if "holdings_group_orders" not in tables:
        return []
    return conn.execute(
        "SELECT section_key, group_key, sort_order FROM holdings_group_orders WHERE sort_order > 0 ORDER BY section_key ASC, sort_order ASC, group_key ASC"
    ).fetchall()


def fetch_global_card_orders(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    card_columns = get_table_columns(conn, "cards")
    if "group_sort_order" not in card_columns:
        return []
    return conn.execute(
        "SELECT id AS card_id, group_sort_order AS sort_order FROM cards WHERE group_sort_order > 0 ORDER BY id ASC"
    ).fetchall()


def collect_legacy_account_snapshot(conn: sqlite3.Connection, account_id: int) -> dict[str, Any]:
    deck_ids = [
        int(row["id"])
        for row in conn.execute("SELECT id FROM decks WHERE account_id = ? ORDER BY id ASC", (account_id,)).fetchall()
    ]
    deck_id_placeholders = ",".join("?" for _ in deck_ids)

    free_rows = conn.execute(
        "SELECT COUNT(*) AS row_count, COALESCE(SUM(quantity), 0) AS total_quantity FROM free_inventory WHERE account_id = ?",
        (account_id,),
    ).fetchone()
    deck_rows = conn.execute(
        "SELECT COUNT(*) AS row_count FROM decks WHERE account_id = ?",
        (account_id,),
    ).fetchone()

    if deck_ids:
        deck_cards_row = conn.execute(
            f"SELECT COUNT(*) AS row_count, COALESCE(SUM(quantity), 0) AS total_quantity, COALESCE(SUM(backup_quantity), 0) AS total_backup_quantity FROM deck_cards WHERE deck_id IN ({deck_id_placeholders})",
            tuple(deck_ids),
        ).fetchone()
        basic_energies_row = conn.execute(
            f"SELECT COUNT(*) AS row_count, COALESCE(SUM(quantity), 0) AS total_quantity FROM deck_basic_energies WHERE deck_id IN ({deck_id_placeholders})",
            tuple(deck_ids),
        ).fetchone()
        section_orders_row = conn.execute(
            f"SELECT COUNT(*) AS row_count FROM deck_section_orders WHERE deck_id IN ({deck_id_placeholders})",
            tuple(deck_ids),
        ).fetchone()
    else:
        deck_cards_row = {"row_count": 0, "total_quantity": 0, "total_backup_quantity": 0}
        basic_energies_row = {"row_count": 0, "total_quantity": 0}
        section_orders_row = {"row_count": 0}

    return {
        "freeInventory": {
            "rowCount": int(free_rows["row_count"]),
            "totalQuantity": int(free_rows["total_quantity"]),
        },
        "decks": {
            "rowCount": int(deck_rows["row_count"]),
        },
        "deckCards": {
            "rowCount": int(deck_cards_row["row_count"]),
            "totalQuantity": int(deck_cards_row["total_quantity"]),
            "totalBackupQuantity": int(deck_cards_row["total_backup_quantity"]),
        },
        "deckBasicEnergies": {
            "rowCount": int(basic_energies_row["row_count"]),
            "totalQuantity": int(basic_energies_row["total_quantity"]),
        },
        "deckSectionOrders": {
            "rowCount": int(section_orders_row["row_count"]),
        },
        "deckIds": deck_ids,
    }


def build_inspection_report(paths: MigrationPaths) -> dict[str, Any]:
    if not paths.database_path.exists():
        raise SystemExit(f"Legacy database not found: {paths.database_path}")

    with sqlite_connection(paths.database_path) as conn:
        ensure_legacy_schema(conn)
        accounts = fetch_accounts(conn)
        global_group_orders = fetch_global_group_orders(conn)
        global_card_orders = fetch_global_card_orders(conn)

        account_reports: list[dict[str, Any]] = []
        for account in accounts:
            account_id = int(account["id"])
            target_path = paths.accounts_dir / f"{account_id}.db"
            snapshot = collect_legacy_account_snapshot(conn, account_id)
            account_reports.append(
                {
                    "id": account_id,
                    "name": account["name"],
                    "targetDbPath": str(target_path),
                    "targetDbExists": target_path.exists(),
                    "legacy": snapshot,
                }
            )

    return {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "rootDir": str(paths.root_dir),
        "dataDir": str(paths.data_dir),
        "databasePath": str(paths.database_path),
        "accountsDir": str(paths.accounts_dir),
        "searchPreferencesPath": str(paths.search_preferences_path),
        "authPath": str(paths.auth_path),
        "searchPreferences": load_search_preferences(paths.search_preferences_path),
        "global": {
            "groupOrderCount": len(global_group_orders),
            "cardOrderCount": len(global_card_orders),
        },
        "accounts": account_reports,
    }


def copy_file_if_exists(source_path: Path, target_path: Path):
    if not source_path.exists():
        return
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, target_path)


def create_backup(paths: MigrationPaths, timestamp: str) -> Path:
    backup_dir = paths.backups_dir / f"db-split-{timestamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    copy_file_if_exists(paths.database_path, backup_dir / paths.database_path.name)
    copy_file_if_exists(paths.search_preferences_path, backup_dir / paths.search_preferences_path.name)
    copy_file_if_exists(paths.auth_path, backup_dir / paths.auth_path.name)
    if paths.accounts_dir.exists():
        account_backup_dir = backup_dir / "accounts"
        for account_db in sorted(paths.accounts_dir.glob("*.db")):
            copy_file_if_exists(account_db, account_backup_dir / account_db.name)
    return backup_dir


def ensure_account_db_schema(account_db_path: Path):
    account_db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite_connection(account_db_path) as conn:
        conn.executescript(ACCOUNT_SCHEMA_SQL)
        conn.execute(f"PRAGMA user_version = {ACCOUNT_DB_SCHEMA_VERSION}")
        conn.commit()


def migrate_account(
    catalog_conn: sqlite3.Connection,
    account_row: sqlite3.Row,
    paths: MigrationPaths,
    search_preferences: dict[str, Any],
    global_group_orders: list[sqlite3.Row],
    global_card_orders: list[sqlite3.Row],
    force: bool,
) -> dict[str, Any]:
    account_id = int(account_row["id"])
    account_db_path = paths.accounts_dir / f"{account_id}.db"
    if account_db_path.exists():
        if not force:
            raise SystemExit(
                f"Target account DB already exists: {account_db_path}. Re-run with --force to overwrite target DB files."
            )
        account_db_path.unlink()

    ensure_account_db_schema(account_db_path)

    decks = catalog_conn.execute(
        "SELECT id, name, description, color, sort_order, created_at, updated_at FROM decks WHERE account_id = ? ORDER BY sort_order ASC, id ASC",
        (account_id,),
    ).fetchall()
    deck_ids = [int(row["id"]) for row in decks]
    deck_id_placeholders = ",".join("?" for _ in deck_ids)

    free_inventory_rows = catalog_conn.execute(
        "SELECT card_id, quantity FROM free_inventory WHERE account_id = ? ORDER BY card_id ASC",
        (account_id,),
    ).fetchall()

    if deck_ids:
        deck_cards = catalog_conn.execute(
            f"SELECT deck_id, card_id, quantity, COALESCE(backup_quantity, 0) AS backup_quantity FROM deck_cards WHERE deck_id IN ({deck_id_placeholders}) ORDER BY deck_id ASC, card_id ASC",
            tuple(deck_ids),
        ).fetchall()
        deck_basic_energies = catalog_conn.execute(
            f"SELECT deck_id, energy_code, quantity FROM deck_basic_energies WHERE deck_id IN ({deck_id_placeholders}) ORDER BY deck_id ASC, energy_code ASC",
            tuple(deck_ids),
        ).fetchall()
        deck_section_orders = catalog_conn.execute(
            f"SELECT deck_id, section_key, entry_key, sort_order FROM deck_section_orders WHERE deck_id IN ({deck_id_placeholders}) ORDER BY deck_id ASC, section_key ASC, sort_order ASC, entry_key ASC",
            tuple(deck_ids),
        ).fetchall()
    else:
        deck_cards = []
        deck_basic_energies = []
        deck_section_orders = []

    with sqlite_connection(account_db_path) as account_conn:
        for row in free_inventory_rows:
            account_conn.execute(
                "INSERT INTO free_inventory(card_id, quantity) VALUES (?, ?)",
                (int(row["card_id"]), int(row["quantity"])),
            )

        for row in decks:
            account_conn.execute(
                "INSERT INTO decks(id, name, description, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    int(row["id"]),
                    row["name"],
                    row["description"],
                    row["color"],
                    int(row["sort_order"]),
                    row["created_at"],
                    row["updated_at"],
                ),
            )

        for row in deck_cards:
            account_conn.execute(
                "INSERT INTO deck_cards(deck_id, card_id, quantity, backup_quantity) VALUES (?, ?, ?, ?)",
                (
                    int(row["deck_id"]),
                    int(row["card_id"]),
                    int(row["quantity"]),
                    int(row["backup_quantity"]),
                ),
            )

        for row in deck_basic_energies:
            account_conn.execute(
                "INSERT INTO deck_basic_energies(deck_id, energy_code, quantity) VALUES (?, ?, ?)",
                (int(row["deck_id"]), row["energy_code"], int(row["quantity"])),
            )

        for row in deck_section_orders:
            account_conn.execute(
                "INSERT INTO deck_section_orders(deck_id, section_key, entry_key, sort_order) VALUES (?, ?, ?, ?)",
                (
                    int(row["deck_id"]),
                    row["section_key"],
                    row["entry_key"],
                    int(row["sort_order"]),
                ),
            )

        for row in global_group_orders:
            account_conn.execute(
                "INSERT INTO holdings_group_orders(section_key, group_key, sort_order) VALUES (?, ?, ?)",
                (row["section_key"], row["group_key"], int(row["sort_order"])),
            )

        for row in global_card_orders:
            account_conn.execute(
                "INSERT INTO holdings_card_orders(card_id, sort_order) VALUES (?, ?)",
                (int(row["card_id"]), int(row["sort_order"])),
            )

        account_conn.execute(
            "INSERT INTO user_settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            ("search.preferences", json.dumps(search_preferences, ensure_ascii=False)),
        )
        account_conn.commit()

        verification = {
            "freeInventory": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM free_inventory").fetchone()[0]),
                "totalQuantity": int(account_conn.execute("SELECT COALESCE(SUM(quantity), 0) FROM free_inventory").fetchone()[0]),
            },
            "decks": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM decks").fetchone()[0]),
            },
            "deckCards": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0]),
                "totalQuantity": int(account_conn.execute("SELECT COALESCE(SUM(quantity), 0) FROM deck_cards").fetchone()[0]),
                "totalBackupQuantity": int(account_conn.execute("SELECT COALESCE(SUM(backup_quantity), 0) FROM deck_cards").fetchone()[0]),
            },
            "deckBasicEnergies": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM deck_basic_energies").fetchone()[0]),
                "totalQuantity": int(account_conn.execute("SELECT COALESCE(SUM(quantity), 0) FROM deck_basic_energies").fetchone()[0]),
            },
            "deckSectionOrders": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM deck_section_orders").fetchone()[0]),
            },
            "holdingsGroupOrders": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM holdings_group_orders").fetchone()[0]),
            },
            "holdingsCardOrders": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM holdings_card_orders").fetchone()[0]),
            },
            "userSettings": {
                "rowCount": int(account_conn.execute("SELECT COUNT(*) FROM user_settings").fetchone()[0]),
            },
        }

    legacy_snapshot = collect_legacy_account_snapshot(catalog_conn, account_id)
    verification_ok = (
        verification["freeInventory"] == legacy_snapshot["freeInventory"]
        and verification["decks"] == legacy_snapshot["decks"]
        and verification["deckCards"] == legacy_snapshot["deckCards"]
        and verification["deckBasicEnergies"] == legacy_snapshot["deckBasicEnergies"]
        and verification["deckSectionOrders"] == legacy_snapshot["deckSectionOrders"]
    )

    return {
        "id": account_id,
        "name": account_row["name"],
        "targetDbPath": str(account_db_path),
        "legacy": legacy_snapshot,
        "verification": verification,
        "verificationOk": verification_ok,
    }


def execute_migration(paths: MigrationPaths, force: bool, report_path: Path | None) -> dict[str, Any]:
    if not paths.database_path.exists():
        raise SystemExit(f"Legacy database not found: {paths.database_path}")

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    backup_dir = create_backup(paths, timestamp)
    search_preferences = load_search_preferences(paths.search_preferences_path)

    with sqlite_connection(paths.database_path) as catalog_conn:
        ensure_legacy_schema(catalog_conn)
        accounts = fetch_accounts(catalog_conn)
        global_group_orders = fetch_global_group_orders(catalog_conn)
        global_card_orders = fetch_global_card_orders(catalog_conn)

        migrated_accounts = [
            migrate_account(
                catalog_conn,
                account_row,
                paths,
                search_preferences,
                global_group_orders,
                global_card_orders,
                force,
            )
            for account_row in accounts
        ]

    report = {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "mode": "apply",
        "rootDir": str(paths.root_dir),
        "dataDir": str(paths.data_dir),
        "databasePath": str(paths.database_path),
        "accountsDir": str(paths.accounts_dir),
        "backupDir": str(backup_dir),
        "searchPreferences": search_preferences,
        "accounts": migrated_accounts,
        "allAccountsVerified": all(item["verificationOk"] for item in migrated_accounts),
    }

    final_report_path = report_path or (backup_dir / "migration-report.json")
    final_report_path.parent.mkdir(parents=True, exist_ok=True)
    final_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report["reportPath"] = str(final_report_path)
    return report


def main() -> int:
    args = parse_args()
    paths = resolve_paths(args)

    if args.apply:
        report = execute_migration(paths, force=args.force, report_path=args.report_path)
    else:
        report = build_inspection_report(paths)
        report["mode"] = "inspect"
        if args.report_path:
            args.report_path.parent.mkdir(parents=True, exist_ok=True)
            args.report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            report["reportPath"] = str(args.report_path)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())