"""Verify per-account DB files after migration."""
import sqlite3
import pathlib


def main():
    accounts_dir = pathlib.Path("data/accounts")
    if not accounts_dir.exists():
        print("accounts/ directory not found - has migration been applied?")
        return 1

    dbs = sorted(accounts_dir.glob("*.db"))
    if not dbs:
        print("No .db files found in accounts/")
        return 1

    for db in dbs:
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        tables_raw = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        tables = [r[0] for r in tables_raw]
        fi = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(quantity),0) FROM free_inventory"
        ).fetchone()
        decks = conn.execute("SELECT COUNT(*) FROM decks").fetchone()
        cards = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(quantity),0) FROM deck_cards"
        ).fetchone()
        prefs = conn.execute("SELECT COUNT(*) FROM user_settings").fetchone()
        group_orders = conn.execute(
            "SELECT COUNT(*) FROM holdings_group_orders"
        ).fetchone()
        card_orders = conn.execute(
            "SELECT COUNT(*) FROM holdings_card_orders"
        ).fetchone()
        conn.close()

        print(f"{db.name}: tables={tables}")
        print(f"  free_inventory: {fi[0]} rows / {fi[1]} total")
        print(f"  decks: {decks[0]}")
        print(f"  deck_cards: {cards[0]} rows / {cards[1]} total")
        print(f"  holdings_group_orders: {group_orders[0]}")
        print(f"  holdings_card_orders: {card_orders[0]}")
        print(f"  user_settings: {prefs[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
