from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.database import SessionLocal
from app.common.enums import (
    CoinRuleTrigger,
    MembershipRole,
    MembershipStatus,
    TeamStatus,
    UserStatus,
)
from app.config import get_settings
from app.models import CoinRule, Organization, Team, TeamMembership, User


@dataclass(frozen=True)
class BootstrapResult:
    organization_id: uuid.UUID
    team_id: uuid.UUID
    admin_id: uuid.UUID


def required(value: str | None, name: str) -> str:
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    stripped = value.strip()
    if not stripped:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return stripped


def non_negative(value: int, name: str) -> int:
    if value < 0:
        raise RuntimeError(f"{name} must be non-negative")
    return value


def bootstrap(
    session: Session,
    *,
    organization_name: str,
    organization_slug: str,
    team_name: str,
    admin_auth_id: uuid.UUID,
    admin_email: str,
    admin_name: str,
    training_reward: int,
    match_reward: int,
) -> BootstrapResult:
    organization_name = required(organization_name, "BOOTSTRAP_ORG_NAME")
    organization_slug = required(organization_slug, "BOOTSTRAP_ORG_SLUG")
    team_name = required(team_name, "BOOTSTRAP_TEAM_NAME")
    admin_email = required(admin_email, "BOOTSTRAP_ADMIN_EMAIL")
    admin_name = required(admin_name, "BOOTSTRAP_ADMIN_NAME")
    training_reward = non_negative(training_reward, "BOOTSTRAP_TRAINING_REWARD")
    match_reward = non_negative(match_reward, "BOOTSTRAP_MATCH_REWARD")

    organization = session.scalar(select(Organization).where(Organization.slug == organization_slug))
    if organization is None:
        organization = Organization(name=organization_name, slug=organization_slug)
        session.add(organization)
        session.flush()

    team = session.scalar(select(Team).where(Team.organization_id == organization.id, Team.name == team_name))
    if team is None:
        team = Team(
            organization_id=organization.id,
            name=team_name,
            description="Bootstrapped team",
            status=TeamStatus.active,
        )
        session.add(team)
        session.flush()

    admin = session.scalar(select(User).where(User.auth_id == admin_auth_id))
    if admin is None:
        admin = User(
            auth_id=admin_auth_id,
            email=admin_email,
            name=admin_name,
            status=UserStatus.active,
        )
        session.add(admin)
        session.flush()
    else:
        admin.email = admin_email
        admin.name = admin_name
        admin.status = UserStatus.active

    membership = session.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team.id,
            TeamMembership.user_id == admin.id,
        )
    )
    if membership is None:
        session.add(
            TeamMembership(
                team_id=team.id,
                user_id=admin.id,
                role=MembershipRole.admin,
                status=MembershipStatus.active,
                joined_at=datetime.now(UTC),
            )
        )
    else:
        membership.role = MembershipRole.admin
        membership.status = MembershipStatus.active
        membership.joined_at = membership.joined_at or datetime.now(UTC)

    default_rules = [
        ("Training signup", CoinRuleTrigger.training_signup, training_reward),
        ("Match signup", CoinRuleTrigger.match_signup, match_reward),
    ]
    for name, trigger_type, amount in default_rules:
        rule = session.scalar(
            select(CoinRule).where(CoinRule.team_id == team.id, CoinRule.trigger_type == trigger_type)
        )
        if rule is None:
            session.add(
                CoinRule(
                    team_id=team.id,
                    name=name,
                    trigger_type=trigger_type,
                    amount=amount,
                    config=None,
                    is_active=True,
                    created_by=admin.id,
                )
            )

    session.commit()
    return BootstrapResult(organization_id=organization.id, team_id=team.id, admin_id=admin.id)


def main() -> None:
    settings = get_settings()
    with SessionLocal() as session:
        result = bootstrap(
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
        print(
            "Bootstrapped "
            f"organization={result.organization_id} team={result.team_id} admin={result.admin_id}"
        )


if __name__ == "__main__":
    main()
