from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.database import SessionLocal
from app.common.enums import (
    CoinRuleTrigger,
    CoinTransactionType,
    EventStatus,
    EventType,
    MembershipRole,
    MembershipStatus,
    TeamStatus,
    UserStatus,
)
from app.config import get_settings
from app.models import (
    CoinRule,
    CoinTransaction,
    Event,
    MatchDetails,
    StoreItem,
    Team,
    TeamMembership,
    User,
)
from scripts.bootstrap import bootstrap, required


@dataclass(frozen=True)
class DeviceSmokeSeedResult:
    team_id: uuid.UUID
    admin_id: uuid.UUID
    member_id: uuid.UUID
    training_event_id: uuid.UUID
    match_event_id: uuid.UUID
    store_item_id: uuid.UUID
    member_balance_seeded: int


def _env_uuid(name: str) -> uuid.UUID:
    return uuid.UUID(required(os.getenv(name), name))


def _env_text(name: str, default: str | None = None) -> str:
    return required(os.getenv(name, default), name)


def _ensure_member(session: Session, team_id: uuid.UUID) -> User:
    member_auth_id = _env_uuid("DEVICE_SMOKE_MEMBER_AUTH_ID")
    member_email = _env_text("DEVICE_SMOKE_MEMBER_EMAIL")
    member_name = _env_text("DEVICE_SMOKE_MEMBER_NAME", "Device Smoke Member")

    member = session.scalar(select(User).where(User.auth_id == member_auth_id))
    if member is None:
        member = User(
            auth_id=member_auth_id,
            email=member_email,
            name=member_name,
            status=UserStatus.active,
        )
        session.add(member)
        session.flush()
    else:
        member.email = member_email
        member.name = member_name
        member.status = UserStatus.active

    membership = session.scalar(
        select(TeamMembership).where(TeamMembership.team_id == team_id, TeamMembership.user_id == member.id)
    )
    if membership is None:
        session.add(
            TeamMembership(
                team_id=team_id,
                user_id=member.id,
                role=MembershipRole.member,
                status=MembershipStatus.active,
                jersey_number="9",
                player_name=member.name,
                joined_at=datetime.now(UTC),
            )
        )
    else:
        membership.role = MembershipRole.member
        membership.status = MembershipStatus.active
        membership.jersey_number = membership.jersey_number or "9"
        membership.player_name = membership.player_name or member.name
        membership.joined_at = membership.joined_at or datetime.now(UTC)

    return member


def _ensure_reward_rule(
    session: Session,
    team_id: uuid.UUID,
    admin_id: uuid.UUID,
    name: str,
    trigger_type: CoinRuleTrigger,
    amount: int,
) -> None:
    rule = session.scalar(select(CoinRule).where(CoinRule.team_id == team_id, CoinRule.trigger_type == trigger_type))
    if rule is None:
        session.add(
            CoinRule(
                team_id=team_id,
                name=name,
                trigger_type=trigger_type,
                amount=amount,
                is_active=True,
                created_by=admin_id,
            )
        )
    else:
        rule.name = rule.name or name
        rule.amount = amount
        rule.is_active = True


def _ensure_published_event(
    session: Session,
    team_id: uuid.UUID,
    admin_id: uuid.UUID,
    *,
    event_type: EventType,
    title: str,
    days_from_now: int,
) -> Event:
    event = session.scalar(
        select(Event)
        .where(
            Event.team_id == team_id,
            Event.title == title,
            Event.status != EventStatus.completed,
        )
        .order_by(Event.start_time.desc())
    )
    start_time = datetime.now(UTC) + timedelta(days=days_from_now)
    if event is None:
        event = Event(
            team_id=team_id,
            type=event_type,
            title=title,
            description="Device smoke test data",
            location="Device Smoke Field",
            start_time=start_time,
            end_time=start_time + timedelta(hours=2),
            status=EventStatus.published,
            created_by=admin_id,
        )
        session.add(event)
        session.flush()
    else:
        event.type = event_type
        event.description = "Device smoke test data"
        event.location = "Device Smoke Field"
        event.start_time = start_time
        event.end_time = start_time + timedelta(hours=2)
        event.status = EventStatus.published

    if event_type == EventType.match:
        match_details = session.scalar(select(MatchDetails).where(MatchDetails.event_id == event.id))
        if match_details is None:
            session.add(MatchDetails(event_id=event.id, opponent="Device Smoke United"))
        else:
            match_details.opponent = "Device Smoke United"

    return event


def _ensure_store_item(session: Session, team_id: uuid.UUID, admin_id: uuid.UUID) -> StoreItem:
    item_name = "Device Smoke Socks"
    item = session.scalar(select(StoreItem).where(StoreItem.team_id == team_id, StoreItem.name == item_name))
    if item is None:
        item = StoreItem(
            team_id=team_id,
            name=item_name,
            description="Seeded item for device smoke redemption",
            image_url="https://cdn.example.test/device-smoke-socks.png",
            price=15,
            stock=10,
            is_active=True,
            created_by=admin_id,
        )
        session.add(item)
        session.flush()
    else:
        item.description = "Seeded item for device smoke redemption"
        item.image_url = "https://cdn.example.test/device-smoke-socks.png"
        item.price = 15
        if item.stock is not None:
            item.stock = max(item.stock, 10)
        item.is_active = True
    return item


def _ensure_seed_balance(
    session: Session,
    team_id: uuid.UUID,
    admin_id: uuid.UUID,
    member_id: uuid.UUID,
) -> int:
    reason = "Device smoke seed balance"
    target_balance = 200
    existing = session.scalar(
        select(CoinTransaction).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == member_id,
            CoinTransaction.type == CoinTransactionType.admin_adjustment,
            CoinTransaction.reason == reason,
        )
    )
    if existing is None:
        existing = CoinTransaction(
            team_id=team_id,
            user_id=member_id,
            amount=200,
            type=CoinTransactionType.admin_adjustment,
            reason=reason,
            reference_type="device_smoke_seed",
            reference_id=member_id,
            created_by=admin_id,
            metadata_={"source": "seed_device_smoke"},
        )
        session.add(existing)
        return existing.amount

    current_balance = session.scalar(
        select(func.coalesce(func.sum(CoinTransaction.amount), 0)).where(
            CoinTransaction.team_id == team_id,
            CoinTransaction.user_id == member_id,
        )
    )
    if current_balance is not None and current_balance < target_balance:
        existing.amount += target_balance - current_balance
    return existing.amount


def seed_device_smoke(session: Session) -> DeviceSmokeSeedResult:
    settings = get_settings()
    bootstrap_result = bootstrap(
        session,
        organization_name=settings.bootstrap_org_name,
        organization_slug=settings.bootstrap_org_slug,
        team_name=settings.bootstrap_team_name,
        admin_auth_id=uuid.UUID(required(settings.bootstrap_admin_auth_id, "BOOTSTRAP_ADMIN_AUTH_ID")),
        admin_email=required(settings.bootstrap_admin_email, "BOOTSTRAP_ADMIN_EMAIL"),
        admin_name=settings.bootstrap_admin_name,
        training_reward=settings.bootstrap_training_reward,
        match_reward=settings.bootstrap_match_reward,
    )

    team = session.get(Team, bootstrap_result.team_id)
    if team is None:
        raise RuntimeError("Bootstrapped team was not found")
    team.status = TeamStatus.active

    member = _ensure_member(session, bootstrap_result.team_id)
    _ensure_reward_rule(
        session,
        bootstrap_result.team_id,
        bootstrap_result.admin_id,
        "Training signup",
        CoinRuleTrigger.training_signup,
        settings.bootstrap_training_reward,
    )
    _ensure_reward_rule(
        session,
        bootstrap_result.team_id,
        bootstrap_result.admin_id,
        "Match signup",
        CoinRuleTrigger.match_signup,
        settings.bootstrap_match_reward,
    )
    training = _ensure_published_event(
        session,
        bootstrap_result.team_id,
        bootstrap_result.admin_id,
        event_type=EventType.training,
        title="Device Smoke Training",
        days_from_now=6,
    )
    match = _ensure_published_event(
        session,
        bootstrap_result.team_id,
        bootstrap_result.admin_id,
        event_type=EventType.match,
        title="Device Smoke Match",
        days_from_now=7,
    )
    item = _ensure_store_item(session, bootstrap_result.team_id, bootstrap_result.admin_id)
    balance_seeded = _ensure_seed_balance(session, bootstrap_result.team_id, bootstrap_result.admin_id, member.id)

    session.commit()
    return DeviceSmokeSeedResult(
        team_id=bootstrap_result.team_id,
        admin_id=bootstrap_result.admin_id,
        member_id=member.id,
        training_event_id=training.id,
        match_event_id=match.id,
        store_item_id=item.id,
        member_balance_seeded=balance_seeded,
    )


def main() -> int:
    with SessionLocal() as session:
        result = seed_device_smoke(session)
    print("Device smoke seed ready:")
    for key, value in result.__dict__.items():
        print(f"- {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
