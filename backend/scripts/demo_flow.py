from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.coins.service import coin_balance
from app.common.database import Base
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventType,
    MatchEntryType,
    MatchResult,
    MembershipRole,
    MembershipStatus,
    SignupStatus,
)
from app.events.match_schemas import MatchLogEntryCreateRequest
from app.events.match_service import create_match_log, delete_match_log, live_board
from app.events.schemas import (
    EventCompletionRequest,
    EventCreateRequest,
    EventSignupUpsertRequest,
    EventUpdateRequest,
    MatchCreateRequest,
    MatchDetailsCreateRequest,
    MatchDetailsUpdateRequest,
)
from app.events.service import (
    complete_event,
    create_event,
    create_match,
    delete_event,
    update_event,
    upsert_my_signup,
)
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
    MatchDetails,
    Organization,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from app.notifications.service import create_team_announcement, unread_count
from app.store.schemas import RedemptionCreateRequest, StoreItemCreateRequest
from app.store.service import (
    create_redemption,
    create_store_item,
    fulfill_redemption,
    refund_redemption,
)


@contextmanager
def demo_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    try:
        with SessionLocal() as session:
            yield session
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def _user(name: str, email: str) -> User:
    return User(auth_id=uuid4(), name=name, email=email)


def seed_demo_team(session: Session) -> tuple[Team, User, User]:
    organization = Organization(name="Demo Club", slug="demo-club")
    admin = _user("队长陈", "admin@example.com")
    player = _user("球员林", "player@example.com")
    session.add_all([organization, admin, player])
    session.flush()

    admin.avatar_url = "https://cdn.example.test/admin.png"
    player.avatar_url = "https://cdn.example.test/player.png"

    team = Team(
        organization_id=organization.id,
        name="Demo FC",
        logo_url="https://cdn.example.test/demo-fc.png",
    )
    session.add(team)
    session.flush()
    joined_at = datetime.now(UTC) - timedelta(days=1)
    session.add_all(
        [
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
                joined_at=joined_at,
            ),
            TeamMembership(
                team_id=team.id,
                user_id=player.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                joined_at=joined_at,
            ),
            CoinRule(
                team_id=team.id,
                name="训练报名奖励",
                trigger_type=CoinRuleTrigger.training_signup,
                amount=10,
                created_by=admin.id,
            ),
            CoinRule(
                team_id=team.id,
                name="比赛报名奖励",
                trigger_type=CoinRuleTrigger.match_signup,
                amount=20,
                created_by=admin.id,
            ),
        ]
    )
    session.commit()
    return team, admin, player


def run_demo_flow() -> dict[str, object]:
    with demo_session() as session:
        team, admin, player = seed_demo_team(session)
        event_start = datetime.now(UTC) + timedelta(days=1)
        event = create_event(
            session,
            team.id,
            admin,
            EventCreateRequest(
                type=EventType.training,
                title="Demo 周末训练",
                location="主球场",
                start_time=event_start,
                end_time=event_start + timedelta(hours=2),
            ),
        )
        assert unread_count(session, player) == 1

        temporary_start = datetime.now(UTC) + timedelta(days=3)
        temporary_event = create_event(
            session,
            team.id,
            admin,
            EventCreateRequest(
                type=EventType.training,
                title="Demo 临时训练",
                location="副球场",
                start_time=temporary_start,
                end_time=temporary_start + timedelta(hours=2),
            ),
        )
        update_event(
            session,
            temporary_event.id,
            admin,
            EventUpdateRequest(title="Demo 临时训练改期"),
        )
        delete_event(session, temporary_event.id, admin)
        assert session.get(Event, temporary_event.id) is None
        assert unread_count(session, player) == 1

        match_start = datetime.now(UTC) + timedelta(days=2)
        match = create_match(
            session,
            team.id,
            admin,
            MatchCreateRequest(
                event=EventCreateRequest(
                    title="Demo 友谊赛",
                    location="客场",
                    start_time=match_start,
                    end_time=match_start + timedelta(hours=2),
                ),
                match_details=MatchDetailsCreateRequest(opponent="Demo United"),
            ),
        )
        signup = upsert_my_signup(
            session,
            match.id,
            player,
            EventSignupUpsertRequest(status=SignupStatus.going),
        )
        create_match_log(
            session,
            match.id,
            admin,
            MatchLogEntryCreateRequest(
                entry_type=MatchEntryType.goal,
                minute=12,
                player_name=player.name,
                player_number="9",
            ),
        )
        yellow_card = create_match_log(
            session,
            match.id,
            admin,
            MatchLogEntryCreateRequest(
                entry_type=MatchEntryType.yellow_card,
                minute=16,
                player_name=player.name,
                player_number="9",
            ),
        )
        delete_match_log(session, yellow_card.id, admin)
        match_board = live_board(session, match.id, player)
        assert signup.status == SignupStatus.going
        assert match_board["counts"]["goal"] == 1
        assert match_board["counts"]["yellow_card"] == 0
        assert unread_count(session, player) == 2
        match_completion = complete_event(
            session,
            match.id,
            admin,
            EventCompletionRequest(
                match_details=MatchDetailsUpdateRequest(
                    team_score=2,
                    opponent_score=1,
                    result=MatchResult.win,
                    notes="Demo final score",
                )
            ),
        )
        match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == match.id))
        assert match_completion["going_count"] == 1
        assert match_details is not None
        assert match_details.team_score == 2
        assert match_details.opponent_score == 1
        assert match_details.result == MatchResult.win
        assert coin_balance(session, team.id, admin, player.id) == 20

        upsert_my_signup(
            session,
            event.id,
            player,
            EventSignupUpsertRequest(status=SignupStatus.going),
        )
        completion = complete_event(session, event.id, admin)
        assert completion["going_count"] == 1
        assert coin_balance(session, team.id, admin, player.id) == 30

        session.add(
            CoinTransaction(
                team_id=team.id,
                user_id=player.id,
                amount=50,
                type=CoinTransactionType.admin_adjustment,
                reason="Demo seed balance",
                created_by=admin.id,
            )
        )
        session.commit()

        item = create_store_item(
            session,
            team.id,
            admin,
            StoreItemCreateRequest(
                name="Demo 队袜",
                image_url="https://cdn.example.test/socks.png",
                price=15,
                stock=2,
                is_active=True,
            ),
        )
        redemption = create_redemption(
            session,
            team.id,
            player,
            RedemptionCreateRequest(id=uuid4(), store_item_id=item.id, quantity=1),
        )
        assert coin_balance(session, team.id, admin, player.id) == 65
        assert session.get(StoreItem, item.id).stock == 1

        fulfill_redemption(session, redemption.id, admin)
        refund_redemption(session, redemption.id, admin)
        assert coin_balance(session, team.id, admin, player.id) == 80
        assert session.get(StoreItem, item.id).stock == 1

        announcement_notifications = create_team_announcement(
            session,
            team.id,
            admin,
            announcement_id=uuid4(),
            title="Demo 球队公告",
            body="周末训练后一起拉伸恢复。",
        )
        assert {notification.user_id for notification in announcement_notifications} == {admin.id, player.id}
        assert unread_count(session, player) == 6

        return {
            "team": team.name,
            "team_logo_url": team.logo_url,
            "event": event.title,
            "match": match.title,
            "match_signup": signup.status,
            "match_goal_count": match_board["counts"]["goal"],
            "match_completion": match_completion,
            "match_final_score": f"{match_details.team_score}-{match_details.opponent_score}",
            "match_result": match_details.result,
            "completion": completion,
            "player_balance": coin_balance(session, team.id, admin, player.id),
            "store_stock": session.get(StoreItem, item.id).stock,
            "store_image_url": session.get(StoreItem, item.id).image_url,
            "player_unread_notifications": unread_count(session, player),
        }


def main() -> int:
    result = run_demo_flow()
    print("Backend demo flow passed:")
    for key, value in result.items():
        print(f"- {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
