from datetime import UTC, datetime
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
SIGNUP_REWARD_MIGRATION = (
    ROOT_DIR / "backend/migrations/versions/20260817_0002_drop_attendance_signup_rewards.py"
)
ALIGNMENT_MIGRATION = (
    ROOT_DIR / "backend/migrations/versions/20260830_0003_align_local_database.py"
)

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
        "player_name",
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
        "cancelled_by",
        "cancelled_at",
        "refunded_by",
        "refunded_at",
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
        "updated_at",
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


def test_database_baseline_has_fourteen_tables() -> None:
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
    match_details = Base.metadata.tables["match_details"]
    coin_transactions = Base.metadata.tables["coin_transactions"]
    device_tokens = Base.metadata.tables["device_tokens"]
    indexes = {index.name: index for index in coin_transactions.indexes}
    notification_indexes = {
        index.name: index for index in Base.metadata.tables["notifications"].indexes
    }
    coin_rule_indexes = {index.name: index for index in Base.metadata.tables["coin_rules"].indexes}

    assert users.columns["auth_id"].unique is True
    assert users.columns["email"].unique is True
    assert organizations.columns["slug"].unique is True
    assert "uq_team_membership_team_user" in {constraint.name for constraint in memberships.constraints}
    assert "uq_event_signup_event_user" in {constraint.name for constraint in signups.constraints}
    assert "attendances" not in Base.metadata.tables
    assert match_details.columns["event_id"].unique is True
    assert "uq_coin_reward_team_user_event" in indexes
    assert indexes["uq_coin_reward_team_user_event"].unique is True
    assert "uq_coin_refund_team_user_redemption" in indexes
    assert indexes["uq_coin_refund_team_user_redemption"].unique is True
    assert "uq_coin_redemption_team_user_reference" in indexes
    assert "uq_notifications_user_type_reference" in notification_indexes
    assert "uq_coin_rules_active_training_signup_team" in coin_rule_indexes
    assert "uq_coin_rules_active_match_signup_team" in coin_rule_indexes
    assert device_tokens.columns["token"].unique is True


def test_database_baseline_keeps_event_dependent_foreign_keys_cascading() -> None:
    expected_event_dependents = {
        "event_signups": "event_id",
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
        "team_memberships": {
            "ck_team_memberships_role": "role IN ('member', 'admin')",
        },
        "events": {
            "ck_events_status": "status IN ('published', 'completed')",
            "ck_events_end_after_start": "end_time > start_time",
        },
        "notifications": {
            "ck_notifications_type": (
                "type IN ('new_event', 'coin_earned', 'redemption_completed', 'team_announcement')"
            ),
        },
        "coin_rules": {
            "ck_coin_rules_amount_non_negative": "amount >= 0",
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


def test_alignment_constraints_and_partial_indexes_are_enforced_by_sqlite_runtime() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    memberships = Base.metadata.tables["team_memberships"]
    events = Base.metadata.tables["events"]
    notifications = Base.metadata.tables["notifications"]
    coin_rules = Base.metadata.tables["coin_rules"]
    coin_transactions = Base.metadata.tables["coin_transactions"]
    team_id = uuid4()
    user_id = uuid4()
    event_id = uuid4()
    reference_id = uuid4()

    try:
        with engine.begin() as connection:
            connection.execute(
                insert(memberships).values(
                    id=uuid4(),
                    team_id=team_id,
                    user_id=user_id,
                    role="member",
                    status="pending",
                    joined_at=None,
                )
            )
        with engine.connect() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    insert(memberships).values(
                        id=uuid4(),
                        team_id=team_id,
                        user_id=uuid4(),
                        role="captain",
                        status="active",
                    )
                )
            connection.rollback()

        with engine.begin() as connection:
            connection.execute(
                insert(events).values(
                    id=event_id,
                    team_id=team_id,
                    type="training",
                    title="Valid",
                    start_time=datetime(2026, 8, 30, 10, tzinfo=UTC),
                    end_time=datetime(2026, 8, 30, 11, tzinfo=UTC),
                    created_by=user_id,
                )
            )
        for invalid_values in (
            {"status": "draft", "end_time": datetime(2026, 8, 30, 11, tzinfo=UTC)},
            {"status": "published", "end_time": None},
            {"status": "published", "end_time": datetime(2026, 8, 30, 9, tzinfo=UTC)},
        ):
            with engine.connect() as connection:
                with pytest.raises(IntegrityError):
                    connection.execute(
                        insert(events).values(
                            id=uuid4(),
                            team_id=team_id,
                            type="training",
                            title="Invalid",
                            start_time=datetime(2026, 8, 30, 10, tzinfo=UTC),
                            created_by=user_id,
                            **invalid_values,
                        )
                    )
                connection.rollback()

        with engine.begin() as connection:
            base_notification = {
                "user_id": user_id,
                "team_id": team_id,
                "type": "new_event",
                "title": "Event",
                "body": "Body",
            }
            connection.execute(
                insert(notifications).values(
                    id=uuid4(), reference_id=reference_id, **base_notification
                )
            )
            connection.execute(
                insert(notifications).values(id=uuid4(), reference_id=None, **base_notification)
            )
            connection.execute(
                insert(notifications).values(id=uuid4(), reference_id=None, **base_notification)
            )
        with engine.connect() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    insert(notifications).values(
                        id=uuid4(), reference_id=reference_id, **base_notification
                    )
                )
            connection.rollback()

        with engine.begin() as connection:
            connection.execute(
                insert(coin_rules).values(
                    id=uuid4(),
                    team_id=team_id,
                    name="Active training",
                    trigger_type="training_signup",
                    amount=0,
                    is_active=True,
                    created_by=user_id,
                )
            )
            connection.execute(
                insert(coin_rules).values(
                    id=uuid4(),
                    team_id=team_id,
                    name="Inactive training",
                    trigger_type="training_signup",
                    amount=1,
                    is_active=False,
                    created_by=user_id,
                )
            )
        with engine.connect() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    insert(coin_rules).values(
                        id=uuid4(),
                        team_id=team_id,
                        name="Duplicate active training",
                        trigger_type="training_signup",
                        amount=1,
                        is_active=True,
                        created_by=user_id,
                    )
                )
            connection.rollback()
            with pytest.raises(IntegrityError):
                connection.execute(
                    insert(coin_rules).values(
                        id=uuid4(),
                        team_id=uuid4(),
                        name="Negative",
                        trigger_type="manual",
                        amount=-1,
                        is_active=True,
                        created_by=user_id,
                    )
                )
            connection.rollback()

        redemption_reference = uuid4()
        with engine.begin() as connection:
            base_transaction = {
                "team_id": team_id,
                "user_id": user_id,
                "amount": -10,
                "reference_id": redemption_reference,
            }
            connection.execute(
                insert(coin_transactions).values(
                    id=uuid4(), type="redemption", **base_transaction
                )
            )
            connection.execute(
                insert(coin_transactions).values(
                    id=uuid4(), type="other_reward", **base_transaction
                )
            )
        with engine.connect() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    insert(coin_transactions).values(
                        id=uuid4(), type="redemption", **base_transaction
                    )
                )
            connection.rollback()
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_redemption_audit_actor_columns_reference_users() -> None:
    redemptions = Base.metadata.tables["redemptions"]

    for column_name in ("cancelled_by", "refunded_by"):
        foreign_keys = list(redemptions.columns[column_name].foreign_keys)
        assert len(foreign_keys) == 1
        assert foreign_keys[0].target_fullname == "users.id"


def test_database_baseline_locks_coin_transaction_partial_index_predicates() -> None:
    coin_transactions = Base.metadata.tables["coin_transactions"]
    expected_indexes = {
        "uq_coin_reward_team_user_event": "type = 'signup_reward' AND reference_type = 'event'",
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

    redemption_index = next(
        index
        for index in coin_transactions.indexes
        if index.name == "uq_coin_redemption_team_user_reference"
    )
    assert [column.name for column in redemption_index.columns] == [
        "team_id",
        "user_id",
        "reference_id",
    ]
    assert str(redemption_index.dialect_options["postgresql"]["where"]) == (
        "type = 'redemption' AND reference_id IS NOT NULL"
    )


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


def test_signup_reward_migration_drops_attendances_and_remaps_types() -> None:
    migration_source = SIGNUP_REWARD_MIGRATION.read_text(encoding="utf-8")

    for phrase in (
        'op.drop_table("attendances")',
        "training_signup",
        "match_signup",
        "late_attendance",
        "signup_reward",
        "attendance_reward",
        'postgresql_where=sa.text("type = \'signup_reward\' AND reference_type = \'event\'")',
        'op.drop_index("uq_coin_reward_team_user_event", table_name="coin_transactions")',
    ):
        assert phrase in migration_source


def test_restricted_event_and_notification_enums_match_database_document() -> None:
    assert set(EventStatus) == {EventStatus.published, EventStatus.completed}
    assert set(NotificationType) == {
        NotificationType.new_event,
        NotificationType.coin_earned,
        NotificationType.redemption_completed,
        NotificationType.team_announcement,
    }


def test_alignment_migration_contains_all_six_database_areas() -> None:
    migration_source = ALIGNMENT_MIGRATION.read_text(encoding="utf-8")

    for phrase in (
        'new_column_name="player_name"',
        'op.drop_column("events", "signup_deadline")',
        '"ck_events_end_after_start"',
        'sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True)',
        '"uq_notifications_user_type_reference"',
        '"ck_coin_rules_amount_non_negative"',
        '"uq_coin_rules_active_training_signup_team"',
        '"uq_coin_rules_active_match_signup_team"',
        '"uq_coin_redemption_team_user_reference"',
        'sa.Column("cancelled_by", postgresql.UUID(as_uuid=True), nullable=True)',
        'sa.Column("refunded_by", postgresql.UUID(as_uuid=True), nullable=True)',
    ):
        assert phrase in migration_source
