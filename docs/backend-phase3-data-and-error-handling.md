# 后端 Phase 3 分层审计：Data 层与全局错误处理

## 0. 实施状态

截至 2026-08-30，本文档方案已落实到后端代码。后续“当前现状”段落保留为改造前审计快照，目标设计、迁移顺序和验收标准则作为实现与回归基线。

已完成：

- teams、events、matches、coins、store、notifications、users、organizations 的数据访问已移入 Repository；球队首页和报名榜的跨表读取已移入 `teams/queries.py`。
- 报名榜使用固定四次批量查询，无报名记录仍按 `maybe` 聚合；活动结算和报名榜共用 `teams/eligibility.py` 的资格规则。
- 写用例通过统一事务边界最多提交一次，内部通知、奖励和退款 Helper 不提交；中途失败回滚已有自动化测试。
- Router 的 `_to_http_error` 和宽泛异常包装已删除；领域错误统一继承 `AppError`，由全局处理器输出稳定的 `detail.code/detail.message`。
- `X-Request-ID` 中间件、JSON 滚动文件日志和 403/404/409/422/500 测试已建立；未知异常只向客户端返回通用错误，完整堆栈仅写本地日志。
- Repository、Query、事务原子性、全局错误响应、日志字段以及原有业务回归测试均纳入 `backend/tests`。

## 1. 文档目的与范围

本文档记录当前后端分层审计中已经确认需要处理的两个问题：

1. Service 层直接执行 SQLAlchemy 查询和写入，缺少独立的 Data / Repository 层。
2. 各 Router 重复捕获和转换异常，缺少统一的应用错误模型、全局异常处理器和本地日志。

本文档同步改造前现状、目标设计、实施方案和验收标准，不在本阶段讨论其他架构问题。

---

## 2. 当前后端调用结构

当前实际结构为：

```text
客户端
  → FastAPI Router
  → Service（业务规则 + SQLAlchemy 查询/写入 + commit）
  → SQLAlchemy Model
  → 数据库
```

Schema 已经独立存在，用于约束 API 请求和响应；Router 也基本保持轻量，没有直接执行 SQL。

主要缺口是：

```text
Router
  → Service
  → Repository / Data
  → Model
```

中的 Repository / Data 层尚未建立。

---

## 3. 问题一：缺少 Data / Repository 层

### 3.1 当前现状

目前各业务 Service 直接依赖：

- SQLAlchemy `Session`
- `select`、`delete`、`func` 等 SQL 构造器
- ORM Model
- `session.add()`、`session.scalar()`、`session.execute()`、`session.flush()` 和 `session.commit()`

例如活动通知同步逻辑直接在 Service 中查询符合资格的成员和已有通知：

```python
eligible_user_ids = set(
    session.scalars(
        select(TeamMembership.user_id).where(
            TeamMembership.team_id == event.team_id,
            TeamMembership.role == MembershipRole.member,
            TeamMembership.status == MembershipStatus.active,
            TeamMembership.joined_at.is_not(None),
            TeamMembership.joined_at <= event.created_at,
        )
    ).all()
)

existing = list(
    session.scalars(
        select(Notification).where(
            Notification.team_id == event.team_id,
            Notification.type == NotificationType.new_event,
            Notification.reference_id == event.id,
        )
    )
)
```

这段代码同时表达了两类内容：

1. 业务规则：哪些用户有资格收到活动通知。
2. 数据访问细节：使用哪些表、字段和 SQLAlchemy API 查出这些用户和通知。

当两类内容都留在 Service 中时，Service 会同时负责业务编排和数据库实现。

### 3.2 带来的问题

#### Service 体积持续增长

随着业务增加，Service 会不断累积查询、写入、权限、状态流转、响应拼装和事务代码，很难快速看出函数真正执行的业务流程。

#### 查询难以复用

有效成员、活动报名、金币余额、事件锁定等查询会在多个业务流程中重复出现。业务规则变化时，需要同时找到并修改所有复制版本。

#### 业务测试和数据库实现耦合

Service 测试通常必须准备真实或模拟的 SQLAlchemy Session。即使只想验证业务分支，也需要理解数据库查询行为。

#### 查询优化分散

批量加载、行锁、索引使用和 N+1 查询优化散落在各 Service，难以统一审查。

#### 事务职责不够直观

有些被其他 Service 调用的函数只执行 `flush`，有些对外业务函数直接 `commit`。调用方仅从函数名难以判断它是否会提前提交整个事务。

### 3.3 目标结构

```text
Router
  │ 解析 HTTP 请求、注入当前用户和数据库 Session
  ▼
Application Service
  │ 一个完整用例、跨模块编排、唯一 commit/rollback 边界
  ▼
Domain Service / Helper
  │ 具体业务规则和业务步骤，必要时 flush，但不提交事务
  ▼
Repository / Data
  │ 查询、增加、修改、删除、锁行、批量加载
  ▼
SQLAlchemy Model
  ▼
PostgreSQL
```

职责约定：

| 层 | 应该负责 | 不应该负责 |
|---|---|---|
| Router | HTTP 参数、依赖注入、调用 Service、声明 Response Schema | SQL、业务规则、事务提交 |
| Application Service | 一个完整业务用例、操作顺序、跨模块编排、`commit/rollback` | HTTP 响应、重复 SQL、在一次用例中多次提交 |
| Domain Service / Helper | 权限和业务规则、完整用例中的具体步骤、必要时 `flush` | `commit/rollback`、HTTP 错误响应 |
| Repository / Data | 数据查询和持久化、锁、批量查询 | HTTP、Pydantic Request Schema、业务流程、`commit` |
| Model | 数据库表、字段、关系和数据库约束 | API 请求响应格式 |
| Schema | API 请求和响应的数据契约 | 数据库查询和权限判断 |

### 3.4 Service 的两层职责与事务契约

Service 在概念上分为两层：

```text
Application Service
  → Domain Service / Helper
```

#### Application Service：完整业务用例

Application Service 表达一个可以从 Router、定时任务或后台脚本触发的完整用例，例如：

- 创建或更新活动；
- 完成活动并结算报名奖励；
- 创建手工金币调整；
- 创建、履约、取消或退款兑换订单；
- 发布球队公告。

它负责：

- 决定业务步骤的执行顺序；
- 调用一个或多个 Domain Service 和 Repository；
- 保证整个用例要么全部成功，要么全部失败；
- 成功时只 `commit` 一次；
- 失败时 `rollback` 并继续抛出异常。

```python
def complete_event(session: Session, event_id: UUID, user: User) -> Event:
    try:
        event = event_repository.get_for_update(session, event_id)
        _check_completion_permission(session, event, user)
        _apply_match_result(session, event)
        _issue_signup_rewards(session, event, user)
        event.status = EventStatus.completed

        session.commit()
        return event
    except Exception:
        session.rollback()
        raise
```

Router 只调用这个用例，不直接控制事务：

```python
@router.post("/events/{event_id}/complete")
def complete_event_route(...):
    return complete_event(session, event_id, user)
```

把事务边界放在 Application Service 而不是 Router，是因为同一个用例还可能被活动自动完成任务、管理脚本或测试直接调用。

#### Domain Service / Helper：具体业务步骤

Domain Service 或 Helper 负责完整用例中的一个步骤，例如：

- `sync_event_notifications`；
- `issue_signup_reward`；
- `create_user_notification`；
- `_refund_redemption`；
- 权限或状态规则检查。

它们可以：

```python
session.add(...)
session.delete(...)
session.flush()
```

但不能：

```python
session.commit()
session.rollback()
```

内部函数不是必须执行 `flush`。更准确的规则是：

```text
不需要数据库生成值或提前检查约束 → 可以不 flush
后续步骤需要 ID、server default 或提前检查约束 → flush
确认整个业务用例永久生效 → 仅 Application Service commit
```

`flush` 只把修改发送到当前数据库事务，仍然可以被外层 `rollback`；`commit` 会结束当前事务，外层之后无法撤销。因此，如果两个步骤属于同一个原子用例，任何内部步骤都不能自行 `commit`。

#### 当前项目中的对应关系

```text
create_event                     Application Service
└── sync_event_notifications     Domain Helper，只 flush

complete_event                   Application Service
└── issue_signup_reward          Domain Helper，只 flush
    └── create_user_notification Domain Helper，只 flush

create_manual_coin_transaction   Application Service
└── create_user_notification     Domain Helper，只 flush

fulfill_redemption               Application Service
└── create_user_notification     Domain Helper，只 flush

cancel_redemption                Application Service
└── _refund_redemption           Domain Helper，不 commit；不需要时也不必 flush
```

第一阶段不要求立刻拆文件，可以用公开函数和内部函数区分：

```python
def complete_event(...):          # Application Service，拥有事务
    ...


def _issue_signup_rewards(...):   # Domain Helper，不提交事务
    ...
```

当模块继续增长时，再拆分为 `application.py` 和 `service.py`。

### 3.5 Repository 的设计原则

#### 按业务语义封装，不机械生成 CRUD

不要求给每张表创建完整的 `create/get/update/delete` 类。优先抽取：

- 被多个 Service 重复使用的查询；
- 条件复杂、容易写错的查询；
- 带 `FOR UPDATE` 的并发查询；
- 单一领域实体的批量加载；
- 需要数据库唯一约束配合的幂等查询。

推荐使用表达业务含义的方法名：

```python
list_active_member_ids_at(...)
get_event_for_update(...)
list_new_event_notifications(...)
find_signup_by_event_and_user(...)
sum_user_team_coin_balance(...)
find_signup_reward_transaction(...)
```

不推荐只增加没有语义的信息搬运：

```python
get_all(...)
run_query(...)
execute_sql(...)
```

#### Service 决定业务条件，Repository 实现查询

例如使用 `event.created_at` 作为通知资格时间点属于业务规则。Service 应明确传入这个时间点：

```python
eligible_user_ids = membership_repository.list_active_member_ids_at(
    session,
    team_id=event.team_id,
    joined_before=event.created_at,
)
```

Repository 只负责把这些条件可靠地转换成数据库查询：

```python
def list_active_member_ids_at(
    session: Session,
    *,
    team_id: UUID,
    joined_before: datetime,
) -> list[UUID]:
    return list(
        session.scalars(
            select(TeamMembership.user_id).where(
                TeamMembership.team_id == team_id,
                TeamMembership.role == MembershipRole.member,
                TeamMembership.status == MembershipStatus.active,
                TeamMembership.joined_at.is_not(None),
                TeamMembership.joined_at <= joined_before,
            )
        ).all()
    )
```

#### Repository 不执行 commit

Repository 可以执行：

```python
session.add(...)
session.delete(...)
session.flush()
session.scalar(...)
session.scalars(...)
session.execute(...)
```

Repository 不执行：

```python
session.commit()
session.rollback()
```

一次业务操作是否整体成功，应由最外层 Service 决定。例如“创建活动 + 创建 Inbox 通知”必须作为一个事务整体提交或整体回滚。

### 3.6 Query / Read 层与 N+1 查询

Repository 主要封装实体或领域数据访问；球队首页、报名榜等跨多张表的只读聚合，不应被强行包装成普通 CRUD Repository。此类读取可以放入独立的 Query / Read 层：

```text
Application Service
  ├── Domain Service / Helper
  ├── Repository
  └── Queries（跨表只读聚合）
```

Query 层可以直接使用 SQLAlchemy 批量读取或聚合，但必须遵守：

- 只读取，不修改 ORM 对象；
- 不调用 `add/delete/flush/commit/rollback`；
- 不依赖 FastAPI、HTTPException 或 Request Schema；
- 返回明确的只读 DTO、dataclass、TypedDict 或数据集合；
- 查询次数不能随着主记录数量线性增长。

#### 当前报名榜的 N+1 现状

当前 `teams.service.signup_board` 先查询一次所有已完成活动，然后在活动循环内分别查询有效成员和报名：

```python
completed_events = list(session.scalars(completed_events_statement))

for event in completed_events:
    eligible_member_ids = list(session.scalars(eligible_members_statement))
    signups = list(session.scalars(event_signups_statement))
```

如果有 `N` 个活动，主要查询次数约为：

```text
1 次：查询 completed events
N 次：逐活动查询成员资格
N 次：逐活动查询报名
1 次：查询相关 User

总计：2N + 2
```

100 个活动会产生约 202 次数据库查询。问题不仅是 SQL 执行时间，还包括每次查询到数据库服务器的网络往返。

#### 重复资格规则已经发生漂移

“活动开始时有效成员”目前分别实现在活动完成结算和报名榜中，而且两个版本已经不一致：

```text
events.service._eligible_member_ids_for_event
  → role=member
  → status=active
  → joined_at <= event.start_time

teams.service.signup_board
  → role=member
  → joined_at <= event.start_time
  → status=active，或者 left_at >= event.start_time
```

当前产品需求规定结算资格要求成员“当前仍为 active”，因此报名榜中的历史离队判断属于需要在迁移时确认和修正的旧逻辑。否则可能出现：

```text
活动结算不把某用户计入资格范围
报名榜却仍然把该用户计入统计
```

在优化查询次数前，必须先确定一个权威资格规则，并让结算和报名榜共享。可以先建立纯业务函数：

```python
def is_membership_eligible_for_event(
    membership: TeamMembership,
    event: Event,
) -> bool:
    return (
        membership.role == MembershipRole.member
        and membership.status == MembershipStatus.active
        and membership.joined_at is not None
        and membership.joined_at <= event.start_time
    )
```

如果资格判断由数据库批量完成，也必须由同一个 Repository/Query 构造器或共享条件函数生成，避免再次复制过滤条件。

#### 推荐的四次批量读取方案

MVP 优先采用固定四次批量查询，再在 Python 中应用资格和默认报名规则：

```text
1. 一次查询时间范围内的全部 completed events
2. 一次查询球队内可能相关的 member memberships
3. 一次查询 event_id IN (...) 的全部 EventSignup
4. 一次查询相关 User
```

报名可以建立复合索引字典：

```python
signup_by_event_and_user = {
    (signup.event_id, signup.user_id): signup.status
    for signup in signups
}
```

聚合时不再查询数据库：

```python
for event in completed_events:
    for membership in memberships:
        if not is_membership_eligible_for_event(membership, event):
            continue

        status = signup_by_event_and_user.get(
            (event.id, membership.user_id),
            SignupStatus.maybe,
        )
        # 在内存中累计 going/maybe/not_going/total
```

查询次数由 `2N + 2` 降为固定 4 次。即使活动数量增加，数据库往返次数也不会线性增长。

可以使用专门的只读数据结构：

```python
@dataclass(frozen=True)
class SignupBoardData:
    events: list[Event]
    memberships: list[TeamMembership]
    signups: list[EventSignup]
    users: list[User]
```

Query 函数示例：

```python
def load_signup_board_data(
    session: Session,
    *,
    team_id: UUID,
    starts_after: datetime | None,
    starts_before: datetime | None,
) -> SignupBoardData:
    ...
```

Application Service 调用 Query 层批量取得数据，再通过共享的 Domain Service 资格规则进行聚合。这样同时兼容前面确定的两层 Service、Repository 和事务契约；因为报名榜是只读用例，不需要 `flush` 或 `commit`。

后续只有在数据量和性能测试证明有必要时，才进一步改为单条 SQL、CTE 或数据库 `GROUP BY` 聚合。第一版优先保证规则清晰、查询次数固定和测试容易理解。

### 3.7 推荐目录

第一阶段可以在现有领域模块内增加 Repository：

```text
backend/app/
├── teams/
│   ├── router.py
│   ├── schemas.py
│   ├── service.py
│   ├── repository.py
│   └── queries.py
├── events/
│   ├── router.py
│   ├── schemas.py
│   ├── service.py
│   └── repository.py
├── notifications/
│   ├── router.py
│   ├── schemas.py
│   ├── service.py
│   └── repository.py
├── coins/
│   └── repository.py
└── store/
    └── repository.py
```

对于球队首页、报名榜等复杂只读聚合，可以单独使用：

```text
teams/queries.py
```

避免把复杂报表查询强行伪装成普通实体 CRUD。

当单个 `service.py` 已经难以区分完整用例和内部步骤时，可以进一步演进为：

```text
events/
├── router.py
├── schemas.py
├── application.py     # create_event、complete_event 等事务边界
├── service.py         # 事件领域规则和内部步骤
├── repository.py      # 事件数据访问
└── queries.py         # 复杂只读聚合，可选
```

不应仅为了目录形式提前拆分；应先明确函数职责和事务契约，再根据模块规模拆文件。

### 3.8 建议迁移顺序

1. 标记每个写入函数是 Application Service 还是 Domain Helper。
2. 确认所有跨 Service 调用的内部函数都不执行 `commit/rollback`。
3. 为所有 Application Service 建立统一的成功 `commit`、失败 `rollback` 边界。
4. 抽取通知同步使用的成员资格和事件通知查询。
5. 抽取球队权限相关的成员关系查询。
6. 抽取 Event 获取、详情、报名和 `FOR UPDATE` 查询。
7. 抽取 CoinRule、CoinTransaction 和余额查询。
8. 抽取兑换中的商品锁定、订单锁定和退款幂等查询。
9. 对齐活动结算与报名榜的成员资格规则，以 requirements.md 的当前业务基线为准。
10. 将报名榜改为固定次数的批量查询，并移入 `teams/queries.py`。
11. 处理球队首页等其他只读聚合，继续消除 N+1 查询。

每次抽取应保持 API 契约和业务行为不变，并使用现有集成测试验证。

### 3.9 验收标准

- Router 中不存在 SQLAlchemy 查询和事务操作。
- Router 不调用 `commit` 或 `rollback`。
- 每个写用例只有一个明确的 Application Service 事务边界。
- Application Service 成功时最多提交一次，异常时显式回滚。
- Domain Service / Helper 不调用 `commit` 或 `rollback`。
- 主要业务 Service 不再直接拼装重复或复杂 SQL。
- Repository 不依赖 FastAPI、HTTPException 或 API Request Schema。
- Repository 不调用 `commit` 或 `rollback`。
- Query 层只读，不调用 `add/delete/flush/commit/rollback`。
- 成员资格、事件通知、报名、余额和行锁查询只有一个权威实现。
- 活动结算与报名榜使用同一套成员资格规则。
- 报名榜数据库查询次数保持固定，不随 completed event 数量线性增长。
- 报名榜在无报名记录时仍按 `maybe` 聚合。
- Repository 单元/集成测试覆盖重要过滤条件和锁定行为。
- Query 层测试覆盖空活动、多个活动、资格边界和查询次数。
- 原子用例测试证明任一内部步骤失败时，此前的修改不会保留。
- 原有业务集成测试全部通过。

---

## 4. 问题二：错误处理分散且缺少本地日志

### 4.1 当前现状

当前多个 Router 分别定义 `_to_http_error`，再在每个路由函数中执行：

```python
try:
    return service(...)
except Exception as exc:
    raise _to_http_error(exc) from exc
```

当前问题包括：

- teams、events、match、coins、store 和 notifications 各维护一套异常映射；
- 大量 `except Exception` 重复存在；
- 相同类型错误可能在不同模块返回不同 code/message；
- 新增业务异常后，需要记得修改对应 Router；
- 未预期异常被转换为通用 500，但缺少统一堆栈日志；
- 当前没有应用级文件日志配置，无法从本地日志稳定追踪请求失败位置。

已有的 `app/common/errors.py` 只提供一个简单的 `not_found()` HTTPException 工具，还没有形成全局错误体系。

### 4.2 目标原则

局部业务代码不应该主动调用 HTTP 错误处理器。

推荐流程是：

```text
Repository / Service 发现错误
  → raise 一个带错误码、消息和上下文的 AppError
  → 异常自然向上传播
  → FastAPI 全局异常处理器统一捕获
  → 记录本地日志
  → 返回统一 HTTP 错误响应
```

局部负责说明“哪里、什么业务、哪个资源出了问题”；全局负责“如何记录和如何响应 HTTP”。

### 4.3 全局错误模型

建议在 `app/common/errors.py` 定义统一基类：

```python
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AppError(Exception):
    code: str
    message: str
    status_code: int
    operation: str
    context: dict[str, Any] = field(default_factory=dict)
    log_level: str = "warning"

    def __post_init__(self) -> None:
        super().__init__(self.message)
```

可以再提供常用子类或工厂：

```python
class ResourceNotFoundError(AppError):
    ...


class PermissionDeniedError(AppError):
    ...


class ConflictError(AppError):
    ...


class BusinessRuleError(AppError):
    ...
```

业务错误码仍应具体，不能只返回抽象分类：

```text
EVENT_NOT_FOUND
EVENT_STATE_CONFLICT
TEAM_PERMISSION_DENIED
DUPLICATE_MEMBERSHIP
INSUFFICIENT_COIN_BALANCE
STORE_ITEM_OUT_OF_STOCK
NOTIFICATION_NOT_FOUND
```

### 4.4 局部抛错方式

Service 或 Repository 在发现可预期错误时，直接抛出异常：

```python
raise ResourceNotFoundError(
    code="EVENT_NOT_FOUND",
    message="Event not found",
    status_code=404,
    operation="events.get_event_for_update",
    context={
        "event_id": str(event_id),
    },
)
```

权限错误可以携带非敏感上下文：

```python
raise PermissionDeniedError(
    code="EVENT_PERMISSION_DENIED",
    message="Only active team admins can update events",
    status_code=403,
    operation="events.update_event",
    context={
        "event_id": str(event.id),
        "team_id": str(event.team_id),
        "user_id": str(user.id),
    },
)
```

这里的 `operation` 是稳定的代码位置/业务操作标识，比把 Python 文件行号硬编码进异常更可靠。对于未预期异常，日志系统会自动记录真实文件名、行号和堆栈。

局部代码不需要：

```python
try:
    ...
except Exception as exc:
    raise global_error_handler(exc)
```

只有需要补充上下文、执行补偿或把数据库特定异常转换为业务冲突时，才进行局部捕获，并使用 `raise ... from exc` 保留原始异常链。

### 4.5 FastAPI 全局异常处理器

建议新增：

```text
backend/app/common/exception_handlers.py
```

由 `main.py` 在应用创建时统一注册：

```python
def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
```

预期业务错误返回现有 API 契约：

```json
{
  "detail": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found"
  }
}
```

未预期异常：

- 使用 `logger.exception(...)` 记录完整堆栈；
- 对客户端只返回通用 `INTERNAL_ERROR`；
- 不向客户端暴露 SQL、文件路径、堆栈、密钥或内部实现。

```json
{
  "detail": {
    "code": "INTERNAL_ERROR",
    "message": "Unexpected error"
  }
}
```

### 4.6 请求定位信息

建议为每个请求生成或接收 `request_id`：

1. 优先读取客户端或网关提供的 `X-Request-ID`。
2. 缺失时由后端生成 UUID。
3. 在响应头中返回同一个 `X-Request-ID`。
4. 全局错误日志中记录该 request_id。

推荐日志上下文：

```text
timestamp
level
request_id
error_code
operation
http_method
request_path
user_id
team_id
event_id / redemption_id / notification_id
message
exception_type
stack_trace（仅未预期异常）
```

不要记录：

- Authorization Bearer token；
- Supabase access token 或刷新令牌；
- 密码和密钥；
- 完整请求头；
- 没有必要的完整请求体；
- 其他用户的敏感个人信息。

### 4.7 本地日志方案

当前阶段日志可以写入本地文件：

```text
backend/logs/app.log
```

仓库已经通过 `*.log` 忽略日志文件，因此日志内容不会被 Git 提交。运行时应自动创建日志目录，不要求在仓库中保存空目录。

建议使用 Python 标准库：

```python
from logging.handlers import RotatingFileHandler
```

建议配置：

```text
LOG_LEVEL=INFO
LOG_DIR=backend/logs
LOG_MAX_BYTES=10485760       # 10 MB
LOG_BACKUP_COUNT=5
```

使用滚动日志而不是无限追加：

```text
app.log
app.log.1
app.log.2
...
```

建议等级：

| 场景 | 日志级别 |
|---|---|
| 404 资源不存在 | INFO 或 WARNING |
| 403 权限拒绝 | WARNING |
| 409 状态/幂等冲突 | WARNING |
| 422 请求格式错误 | INFO |
| 数据库异常、未知异常 | ERROR，并记录堆栈 |

当前阶段以本地文件为主要落点；以后部署到容器或云平台时，应改为或同时输出到 stdout，由平台集中采集。本地文件路径不应成为业务代码的硬编码依赖。

### 4.8 推荐目录

```text
backend/app/common/
├── errors.py                 # AppError 与业务错误类型
├── exception_handlers.py     # FastAPI 全局异常处理器
├── logging.py                # 日志 formatter、handler 和初始化
└── request_context.py        # request_id 与请求上下文
```

领域模块仍可保留自己的错误定义，但必须继承统一基类：

```text
events/errors.py
teams/errors.py
coins/errors.py
store/errors.py
notifications/errors.py
```

例如：

```python
class EventNotFoundError(ResourceNotFoundError):
    ...
```

### 4.9 迁移顺序

1. 建立日志初始化和滚动文件 Handler。
2. 建立 request_id 中间件和请求上下文。
3. 定义 `AppError`、通用错误分类和稳定错误码。
4. 注册 AppError、请求校验错误和未知异常的全局处理器。
5. 逐个领域让现有错误继承统一错误基类。
6. 删除 Router 中的 `_to_http_error` 和重复 `try/except Exception`。
7. 为数据库唯一约束、并发冲突等增加局部异常转换，并保留异常链。
8. 增加错误响应、日志字段和敏感信息保护测试。

### 4.10 验收标准

- 所有业务错误响应继续符合 `detail.code/detail.message` 契约。
- Router 不再定义 `_to_http_error`。
- Router 不再使用宽泛的 `except Exception` 包裹每次 Service 调用。
- 业务错误通过统一 `AppError` 类型传播。
- 全局处理器统一决定 HTTP 状态码和响应格式。
- 未预期异常返回通用 500，并在本地日志中保留完整堆栈。
- 每条错误日志包含 request_id、error_code、operation、请求方法和路径。
- 响应头返回 `X-Request-ID`，可用于定位本地日志。
- 日志采用滚动文件，避免无限增长。
- 日志不包含 token、密码、密钥或不必要的敏感请求数据。
- 测试覆盖 403、404、409、422、500 以及日志写入行为。

---

## 5. 两项改造后的整体流程

```text
客户端请求
  ↓
Request Schema 验证
  ↓
Router 调用 Service
  ↓
Application Service 开启完整业务用例
  ↓
Domain Service / Helper 执行业务规则和具体步骤
  ↓
Repository 执行数据库操作
  ↓
成功：Application Service 统一 commit 并返回结果
失败：Application Service 统一 rollback 并继续抛出异常
  ↓
Response Schema 输出稳定 JSON

只读聚合请求（例如报名榜）
  ↓
Router 调用 Application Service
  ↓
Queries 固定次数批量读取跨表数据
  ↓
Domain Service / Helper 应用共享业务规则并聚合
  ↓
Response Schema 输出结果；全程不 flush、不 commit

任意层发现预期业务错误
  ↓ raise AppError
全局异常处理器
  ├── 写入带 request_id 的本地日志
  └── 返回统一 detail.code/detail.message

未预期异常
  ↓
全局兜底处理器
  ├── 写入完整异常堆栈
  └── 向客户端隐藏内部细节并返回 INTERNAL_ERROR
```

这两项改造的共同目标是：Service 中只保留容易阅读和验证的业务流程，实体数据库访问由 Repository 负责，跨表只读聚合由 Queries 负责，异常响应和日志由全局基础设施负责。
