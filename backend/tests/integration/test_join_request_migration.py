from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_submission_time_migration_preserves_historical_memberships() -> None:
    migration = import_module("migrations.versions.20260906_0007_add_request_submitted_at")
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE team_memberships (id TEXT PRIMARY KEY, status TEXT)"))
        connection.execute(text("INSERT INTO team_memberships VALUES ('historical', 'pending')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.execute(text(
                "SELECT id, status, request_submitted_at FROM team_memberships"
            )).one() == ("historical", "pending", None)
            connection.execute(text(
                "UPDATE team_memberships SET request_submitted_at = '2026-09-06T10:00:00Z'"
            ))
            migration.downgrade()
        assert {column["name"] for column in inspect(connection).get_columns("team_memberships")} == {
            "id", "status"
        }
        assert connection.execute(text("SELECT id, status FROM team_memberships")).one() == (
            "historical", "pending"
        )
    engine.dispose()
