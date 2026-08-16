from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import CheckConstraint, create_engine, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.common.database import Base
from app.common.enums import EventStatus, NotificationType

ROOT_DIR = Path(__file__).resolve().parents[3]
INITIAL_MIGRATION = ROOT_DIR / "backend/migrations/versions/20260815_0001_initial.py"

EXPECTED_TABLE_COLUMNS = {
    "users": {
        "id",
        "auth_id",
        "name",
        "student_id",
        "email",
        "avatar_url",
        "status",
        "created_at",
        "updated_at",
    },
    "organizations": {"id", "name", "slug", "logo_url", "created_at", "updated_at"},
    "teams": {
        "id",
        "organization_id",
        "name",
        "description",
        "logo_url",
        "status",
        "created_at",
        "updated_at",
    },
    "team_memberships": {
        "id",
        "team_id",
        "user_id",
        "role",
        "jersey_number",
        "position",
        "status",
        "joined_at",
        "left_at",
        "created_at",
        "updated_at",
    },
    "events": {
        "id",
        "team_id",
        "type",
        "title",
        "description",
        "location",
        "start_time",
        "end_time",
        "signup_deadline",
        "status",
        "created_by",
        "created_at",
        "updated_at",
    },
    "event_signups": {
        "id",
        "event_id",
        "user_id",
        "status",
        "note",
        "created_at",
        "updated_at",
    },
    "attendances": {
        "id",
        "event_id",
        "user_id",
        "status",
        "recorded_by",
        "recorded_at",
        "note",
        "created_at",
        "updated_at",
    },
    "match_details": {
        "id",
        "event_id",
        "opponent",
        "team_score",
        "opponent_score",
        "result",
        "notes",
        "created_at",
        "updated_at",
    },
    "match_log_entries": {
        "id",
        "event_id",
        "entry_type",
        "minute",
        "player_name",
        "player_number",
        "sub_out_player_name",
        "sub_out_player_number",
        "sub_in_player_name",
        "sub_in_player_number",
        "created_by",
        "created_at",
        "updated_at",
    },
    "coin_rules": {
        "id",
        "team_id",
        "name",
        "trigger_type",
        "amount",
        "config",
        "is_active",
        "created_by",
        "created_at",
        "updated_at",
    },
    "coin_transactions": {
        "id",
        "team_id",
        "user_id",
        "amount",
        "type",
        "reason",
        "reference_type",
        "reference_id",
        "created_by",
        "metadata",
        "created_at",
    },
    "store_items": {
        "id",
        "team_id",
        "name",
        "description",
        "image_url",
        "price",
        "stock",
        "is_active",
        "created_by",
        "created_at",
        "updated_at",
    },
    "redemptions": {
        "id",
        "team_id",
        "user_id",
        "store_item_id",
        "quantity",
        "unit_price",
        "total_price",
        "status",
        "fulfilled_by",
        "fulfilled_at",
        "created_at",
        "updated_at",
    },
    "notifications": {
        "id",
        "user_id",
        "team_id",
        "type",
        "title",
        "body",
        "reference_type",
        "reference_id",
        "read_at",
        "created_at",
        "expires_at",
    },
    "device_tokens": {
        "id",
        "user_id",
        "token",
        "platform",
        "is_active",
        "last_seen_at",
        "created_at",
        "updated_at",
    },
}


def _migration_create_table_block(migration_source: str, table_name: str) -> str:
    start = migration_source.index(f'op.create_table(\n        "{table_name}"')
    next_table = migration_source.find("\n    op.create_table(", start + 1)
    if next_table == -1:
        next_table = migration_source.find("\n\ndef downgrade()", start + 1)
    return migration_source[start:next_table]


def test_database_baseline_has_fifteen_tables() -> None:
    assert set(Base.metadata.tables) == set(EXPECTED_TABLE_COLUMNS)


def test_database_baseline_table_columns_match_database_document() -> None:
    for table_name, expected_columns in EXPECTED_TABLE_COLUMNS.items():
        table = Base.metadata.tables[table_name]

        assert {column.name for column in table.columns} == expected_columns


def test_database_baseline_keeps_required_uniqueness_guards() -> None:
    users = Base.metadata.tables["users"]
    organizations = Base.metadata.tables["organizations"]
    memberships = Base.metadata.tables["team_memberships"]
    signups = Base.metadata.tables["event_signups"]
    attendances = Base.metadata.tables["attendances"]
    match_details = Base.metadata.tables["match_details"]
    coin_transactions = Base.metadata.tables["coin_transactions"]
    device_tokens = Base.metadata.tables["device_tokens"]
    indexes = {index.name: index for index in coin_transactions.indexes}

    assert users.columns["auth_id"].unique is True
    assert users.columns["email"].unique is True
    assert organizations.columns["slug"].unique is True
    assert "uq_team_membership_team_user" in {constraint.name for constraint in memberships.constraints}
    assert "uq_event_signup_event_user" in {constraint.name for constraint in signups.constraints}
    assert "uq_attendance_event_user" in {constraint.name for constraint in attendances.constraints}
    assert match_details.columns["event_id"].unique is True
    assert "uq_coin_reward_team_user_event" in indexes
    assert indexes["uq_coin_reward_team_user_event"].unique is True
    assert "uq_coin_refund_team_user_redemption" in indexes
    assert indexes["uq_coin_refund_team_user_redemption"].unique is True
    assert device_tokens.columns["token"].unique is True


def test_database_baseline_keeps_event_dependent_foreign_keys_cascading() -> None:
    expected_event_dependents = {
        "event_signups": "event_id",
        "attendances": "event_id",
        "match_details": "event_id",
        "match_log_entries": "event_id",
    }

    for table_name, column_name in expected_event_dependents.items():
        table = Base.metadata.tables[table_name]
        foreign_keys = list(table.columns[column_name].foreign_keys)

        assert len(foreign_keys) == 1
        assert foreign_keys[0].target_fullname == "events.id"
        assert foreign_keys[0].ondelete == "CASCADE"


def test_database_baseline_keeps_transactional_numeric_check_constraints() -> None:
    expected_constraints = {
        "match_log_entries": {
            "ck_match_log_entries_minute_non_negative": "minute >= 0",
        },
        "store_items": {
            "ck_store_items_price_positive": "price > 0",
            "ck_store_items_stock_non_negative": "stock IS NULL OR stock >= 0",
        },
        "redemptions": {
            "ck_redemptions_quantity_positive": "quantity > 0",
            "ck_redemptions_unit_price_positive": "unit_price > 0",
            "ck_redemptions_total_price_positive": "total_price > 0",
        },
    }

    for table_name, constraints in expected_constraints.items():
        table = Base.metadata.tables[table_name]
        check_constraints = {
            constraint.name: str(constraint.sqltext)
            for constraint in table.constraints
            if isinstance(constraint, CheckConstraint)
        }

        assert check_constraints == constraints


def test_database_numeric_check_constraints_are_enforced_by_sqlite_runtime() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    invalid_rows = (
        (
            "match_log_entries",
            {
                "id": uuid4(),
                "event_id": uuid4(),
                "entry_type": "goal",
                "minute": -1,
                "created_by": uuid4(),
            },
        ),
        (
            "store_items",
            {
                "id": uuid4(),
                "team_id": uuid4(),
                "name": "Invalid price",
                "price": 0,
                "stock": 1,
                "is_active": True,
                "created_by": uuid4(),
            },
        ),
        (
            "store_items",
            {
                "id": uuid4(),
                "team_id": uuid4(),
                "name": "Invalid stock",
                "price": 1,
                "stock": -1,
                "is_active": True,
                "created_by": uuid4(),
            },
        ),
        (
            "redemptions",
            {
                "id": uuid4(),
                "team_id": uuid4(),
                "user_id": uuid4(),
                "store_item_id": uuid4(),
                "quantity": 0,
                "unit_price": 1,
                "total_price": 1,
                "status": "pending",
            },
        ),
    )

    try:
        with engine.connect() as connection:
            for table_name, values in invalid_rows:
                with pytest.raises(IntegrityError):
                    connection.execute(insert(Base.metadata.tables[table_name]).values(**values))
                connection.rollback()
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_database_baseline_locks_coin_transaction_partial_index_predicates() -> None:
    coin_transactions = Base.metadata.tables["coin_transactions"]
    expected_indexes = {
        "uq_coin_reward_team_user_event": "type = 'attendance_reward' AND reference_type = 'event'",
        "uq_coin_refund_team_user_redemption": "type = 'refund' AND reference_type = 'redemption'",
    }

    for index_name, predicate in expected_indexes.items():
        index = next(index for index in coin_transactions.indexes if index.name == index_name)

        assert [column.name for column in index.columns] == [
            "team_id",
            "user_id",
            "reference_type",
            "reference_id",
        ]
        assert str(index.dialect_options["postgresql"]["where"]) == predicate
        assert str(index.dialect_options["sqlite"]["where"]) == predicate


def test_initial_migration_preserves_database_baseline_guards() -> None:
    migration_source = INITIAL_MIGRATION.read_text(encoding="utf-8")

    for phrase in (
        'sa.UniqueConstraint("team_id", "user_id", name="uq_team_membership_team_user")',
        'sa.UniqueConstraint("event_id", "user_id", name="uq_event_signup_event_user")',
        'sa.UniqueConstraint("event_id", "user_id", name="uq_attendance_event_user")',
        'sa.Column("auth_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True)',
        'sa.Column("email", sa.String(length=255), nullable=False, unique=True)',
        'sa.Column("slug", sa.String(length=120), nullable=False, unique=True)',
        'sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False, unique=True)',
        'sa.ForeignKey("events.id", ondelete="CASCADE")',
        '"uq_coin_reward_team_user_event"',
        '"uq_coin_refund_team_user_redemption"',
        '["team_id", "user_id", "reference_type", "reference_id"]',
        'postgresql_where=sa.text("type = \'attendance_reward\' AND reference_type = \'event\'")',
        'postgresql_where=sa.text("type = \'refund\' AND reference_type = \'redemption\'")',
        'sa.Column("token", sa.String(length=255), nullable=False, unique=True)',
        'sa.CheckConstraint("minute >= 0", name="ck_match_log_entries_minute_non_negative")',
        'sa.CheckConstraint("price > 0", name="ck_store_items_price_positive")',
        'sa.CheckConstraint("stock IS NULL OR stock >= 0", name="ck_store_items_stock_non_negative")',
        'sa.CheckConstraint("quantity > 0", name="ck_redemptions_quantity_positive")',
        'sa.CheckConstraint("unit_price > 0", name="ck_redemptions_unit_price_positive")',
        'sa.CheckConstraint("total_price > 0", name="ck_redemptions_total_price_positive")',
    ):
        assert phrase in migration_source

    expected_table_constraints = {
        "match_log_entries": (
            'sa.CheckConstraint("minute >= 0", name="ck_match_log_entries_minute_non_negative")',
        ),
        "store_items": (
            'sa.CheckConstraint("price > 0", name="ck_store_items_price_positive")',
            'sa.CheckConstraint("stock IS NULL OR stock >= 0", name="ck_store_items_stock_non_negative")',
        ),
        "redemptions": (
            'sa.CheckConstraint("quantity > 0", name="ck_redemptions_quantity_positive")',
            'sa.CheckConstraint("unit_price > 0", name="ck_redemptions_unit_price_positive")',
            'sa.CheckConstraint("total_price > 0", name="ck_redemptions_total_price_positive")',
        ),
    }
    for table_name, constraints in expected_table_constraints.items():
        table_block = _migration_create_table_block(migration_source, table_name)
        for constraint in constraints:
            assert constraint in table_block


def test_confirmed_event_and_notification_enums_are_present() -> None:
    assert EventStatus.cancelled == "cancelled"
    assert NotificationType.event_updated == "event_updated"
    assert NotificationType.event_deleted == "event_deleted"
