# Workout Tracker 项目接管与架构审计笔记

> 本文用于理解和审查分层，示例实体、接口和代码不是实现契约。业务以 `requirements.md`、数据以 `database.md`、HTTP 契约以 `api-spec.md` 为准；分层和事务遵守 `AGENTS.md` 与 `tech_stack.md`。写用例由 Application Service 使用 `transaction_boundary(session)` 统一提交或回滚，Repository 最多 flush。

这份文档的目标不是重新写一套“软件工程理论”，而是帮你建立对这个项目的掌控感：你打开代码仓库后，应该按什么顺序看、每一步看什么、怎么判断当前设计是否合理。

项目背景：这是一个给球队使用的训练记录系统。你作为项目 owner，最终应该能清楚回答：

- 这个系统解决什么问题？
- 它有哪些核心对象？
- 数据库为什么这样设计？
- 后端代码为什么这样分层？
- 前后端之间的 API 契约是否稳定？
- 以后要扩展功能时，大概要改哪些地方？

下面是建议的前 5 步审计顺序。

## 1. 先梳理业务场景

不要一上来就看数据库表，也不要一上来就看代码结构。数据库和代码是否合理，必须回到业务场景里判断。

对于 Workout Tracker，第一版可以先明确几个核心问题：

- 谁在使用这个系统？
- 每类用户想完成什么事情？
- 哪些功能是第一版必须有的？
- 哪些功能可以以后再做？

可以先把用户角色分出来：

| 角色 | 关心的问题 | 可能需要的功能 |
|---|---|---|
| 队员 | 我是否参加训练/比赛？我的报名和金币情况如何？ | 查看活动、报名/请假、查看报名榜、兑换商品 |
| 球队管理员 | 队员报名是否稳定？活动和激励制度是否运转？ | 创建活动、查看报名、完成结算、管理成员/金币/商品 |

第一版 MVP 可以先只支持：

1. 用户注册 / 登录
2. 用户创建或加入球队
3. 球队管理员创建训练/比赛活动并发送 Inbox 通知
4. 队员报名参加、待定或请假并填写原因
5. 活动到达结束时间后由后端自动完成，按 `going` 报名统计并发放金币
6. 队员查看报名榜、金币流水并兑换商品

这一阶段的关键不是“功能越多越好”，而是先确定系统边界。你要知道第一版到底服务哪些场景，不服务哪些场景。

可以暂时不做：

- AI 训练建议
- 复杂图表
- 伤病预测
- 比赛表现分析
- 真实出勤点名和赛后考勤修正
- 智能排阵

这些是未来扩展点，不应该干扰第一版核心结构。

## 2. 检查数据库组织形式

业务场景清楚之后，再看数据库。

数据库设计的核心问题是：它有没有正确表达现实世界里的关系？

Workout Tracker 第一版至少应该有这些核心实体：

- `User`
- `Team`
- `TeamMember`
- `EventSignup`
- `CoinTransaction`
- `StoreItem`
- `Redemption`

一个比较合理的关系是：

```text
User 1 --- N TeamMember N --- 1 Team

Event 1 --- N EventSignup N --- 1 User
Team 1 --- N CoinTransaction N --- 1 User
Team 1 --- N StoreItem 1 --- N Redemption N --- 1 User
```

也就是说：

- 一个用户可以加入多个球队。
- 一个球队有多个用户。
- `TeamMember` 是用户和球队之间的中间关系。
- `EventSignup` 表达队员对活动的参与意愿。
- 完成活动时按 `going` 报名结算 `signup_reward`，不维护独立 Attendance。

这里有一个很重要的设计判断：为什么不直接在 `User` 表里放一个 `team_id`？

因为那样就默认“一个用户只能属于一个球队”。但真实情况里，一个人可能属于多个队，比如新雅院队、课外球队、临时比赛队。如果一开始把这个关系写死，后面扩展会很痛苦。

所以更合理的是：

```text
User
- id
- name
- email
- password_hash

Team
- id
- name
- created_by

TeamMember
- id
- user_id
- team_id
- role
- jersey_number
- position

EventSignup
- id
- event_id
- user_id
- status
- note
```

检查数据库时，可以问这些问题：

- `User` 和 `Team` 是不是多对多关系？
- 有没有 `TeamMember` 这种中间表？
- `TeamMember` / `TeamMembership` 里有没有 `role`，并且是否只有 member/admin 两类业务逻辑？
- admin 是否不能报名、不能进入统计、不能获得奖励？
- `EventSignup` 是否同时关联 `event_id` 和 `user_id`？
- 是否明确不再维护独立 Attendance/late 逻辑？
- 是否能支持以后新增活动类型？
- 是否能支持球队维度统计？
- 是否能支持个人维度统计？

一个好的数据库设计不一定很复杂，但应该把核心关系表达对。

## 3. 检查后端代码分层

这一部分就是看代码有没有“各司其职”。

一个清晰的后端通常可以分成几层：

```text
Router 层：接收 HTTP 请求，调用对应业务函数
Service 层：处理业务规则
Repository / Data 层：封装数据库读写
Model 层：定义数据库表结构
Schema 层：定义请求和响应的数据格式
```

以“提交训练记录”为例，理想流程应该是：

```text
前端提交表单
→ POST /teams/{team_id}/workouts
→ Router 接收请求
→ Service 检查权限和业务规则
→ Repository 写入数据库
→ 返回稳定的 Response
```

Router 层应该比较薄。

它负责：

- 接收请求
- 解析路径参数和请求体
- 获取当前登录用户
- 调用 service
- 返回结果

它不应该塞满复杂业务逻辑。

例如：

```python
@router.post("/teams/{team_id}/workouts")
def create_workout(team_id: int, payload: WorkoutCreate, user=Depends(get_current_user)):
    return workout_service.create_workout(
        user_id=user.id,
        team_id=team_id,
        payload=payload,
    )
```

Service 层负责业务规则。

例如：

```python
def create_workout(user_id: int, team_id: int, payload: WorkoutCreate):
    if not team_repo.is_member(user_id, team_id):
        raise PermissionError("You are not in this team")

    if payload.duration_minutes <= 0:
        raise ValueError("Duration must be positive")

    workout = workout_repo.create_workout(
        user_id=user_id,
        team_id=team_id,
        workout_type=payload.workout_type,
        duration_minutes=payload.duration_minutes,
        intensity=payload.intensity,
        note=payload.note,
    )

    return workout
```

Repository / Data 层负责数据库操作。

例如：

```python
def create_workout(user_id, team_id, workout_type, duration_minutes, intensity, note):
    workout = WorkoutRecord(
        user_id=user_id,
        team_id=team_id,
        workout_type=workout_type,
        duration_minutes=duration_minutes,
        intensity=intensity,
        note=note,
    )
    db.add(workout)
    db.flush()  # 事务由 Application Service 的 transaction_boundary 管理
    db.refresh(workout)
    return workout
```

检查代码分层时，可以重点看：

- Router 里是不是直接写了大量数据库查询？
- Router 里是不是塞了很多权限判断和业务判断？
- Service 里是否集中处理业务规则？
- Repository / Data 层是否封装了常用数据库操作？
- 数据库查询是否到处复制？
- 错误处理是否统一？
- 统计逻辑是否有明确归属？

可以用一句话判断：

> Router 负责“把 HTTP 请求翻译成业务调用”；Service 负责“业务规则”；Repository 负责“数据库读写”。

## 4. 检查后端 API 契约

前后端合作时，API 契约非常关键。

所谓 API 契约，就是前端和后端约定清楚：

- 调哪个 endpoint？
- 用什么 HTTP method？
- URL 参数是什么？
- Request body 长什么样？
- Response body 长什么样？
- 错误时返回什么格式？
- 分页、筛选、排序怎么表达？

比如“提交训练记录”的 API 契约可以长这样：

```text
POST /teams/{team_id}/workouts
```

Request:

```json
{
  "workout_type": "running",
  "duration_minutes": 45,
  "intensity": 7,
  "note": "easy run"
}
```

Response:

```json
{
  "id": 123,
  "user_id": 5,
  "team_id": 1,
  "workout_type": "running",
  "duration_minutes": 45,
  "intensity": 7,
  "note": "easy run",
  "created_at": "2026-08-25T20:30:00Z"
}
```

错误返回也应该稳定，例如：

```json
{
  "error": {
    "code": "NOT_TEAM_MEMBER",
    "message": "You are not a member of this team."
  }
}
```

这一层很重要，因为 AI 写代码时很容易今天用 `duration`，明天用 `duration_minutes`，后天又改成 `minutes`。字段名一乱，前后端就会互相打架。

检查 API 时，可以列一张表：

| 功能 | Method | Endpoint | Request | Response | 权限 |
|---|---|---|---|---|---|
| 注册 | POST | `/auth/register` | email/password/name | user/token | public |
| 登录 | POST | `/auth/login` | email/password | token/user | public |
| 创建球队 | POST | `/teams` | team name | team | logged in |
| 加入球队 | POST | `/teams/{team_id}/members` | user info/code | membership | logged in |
| 创建活动 | POST | `/teams/{team_id}/events` | event data | event | admin |
| 活动报名 | PUT | `/events/{event_id}/signup` | status/note | signup | member |
| 查看报名榜 | GET | `/teams/{team_id}/signup-board` | query params | signup board | member/admin |

检查 API 契约时，可以问：

- endpoint 命名是否一致？
- URL 是否体现资源关系？
- Request / Response 字段名是否稳定？
- 错误格式是否统一？
- 权限要求是否清楚？
- 前端是否依赖了后端内部实现细节？
- 是否有 Swagger / OpenAPI 文档？

API 契约稳定之后，前后端才能分开演化。

## 5. 检查前端页面与状态组织

前端不是简单“调接口然后显示一下”。它也有自己的结构。

你需要知道：

- 有哪些页面？
- 每个页面对应哪些用户场景？
- 每个页面依赖哪些 API？
- 登录态存在什么地方？
- 页面状态怎么管理？
- 错误和 loading 怎么展示？

第一版前端页面可以先这样理解：

```text
/login
  - 登录
  - 调 POST /auth/login

/teams
  - 查看自己加入的球队
  - 创建或加入球队

/teams/{team_id}
  - 球队主页
  - 展示队员、训练入口、统计入口

/events/{event_id}
  - 查看活动详情并报名
  - 调 GET /events/{event_id}
  - 调 PUT /events/{event_id}/signup

/teams/{team_id}/signup-board
  - 查看报名榜
  - 调 GET /teams/{team_id}/signup-board

/teams/{team_id}/events
  - 管理员创建/查看活动
  - 调 GET /teams/{team_id}/events
  - 调 POST /teams/{team_id}/events
```

可以进一步整理成表：

| 页面 | 用户目标 | 依赖 API | 关键状态 |
|---|---|---|---|
| `/login` | 登录系统 | `POST /auth/login` | token, currentUser |
| `/teams` | 查看/加入球队 | `GET /teams`, `POST /teams` | team list |
| `/teams/{team_id}` | 进入球队主页 | `GET /teams/{team_id}` | currentTeam |
| `/events/{event_id}` | 查看活动并报名 | `GET /events/{event_id}`, `PUT /events/{event_id}/signup` | event, signup |
| `/signup-board` | 查看报名榜 | `GET /teams/{team_id}/signup-board` | ranking, filters |
| `/teams/{team_id}/events` | 管理员管理活动 | `GET /teams/{team_id}/events`, `POST /teams/{team_id}/events` | events, form state |

检查前端时，可以问：

- 页面结构是否和用户流程一致？
- API 调用是否集中管理，还是散落在各个组件里？
- 登录态是否统一处理？
- token 过期怎么办？
- loading / error / empty state 是否都有处理？
- 表单字段是否和后端 schema 对齐？
- 页面是否依赖后端返回的临时字段？

如果前端页面、状态、API 依赖都清楚，你就能很快判断一个新功能会影响哪些地方。

## 总结：你要建立的 mental map

完整的理解链条是：

```text
业务场景
  ↓
数据模型
  ↓
后端分层
  ↓
API 契约
  ↓
前端页面与状态
```

这 5 步过完之后，你应该能回答：

- 当前系统第一版到底想解决什么问题？
- 数据库是否表达了正确的现实关系？
- 后端代码是否分层清楚？
- API 是否稳定、清晰、适合前端使用？
- 前端页面是否对应真实用户流程？

如果这些问题你都能答出来，你就不再只是“让 AI 写了一个项目”，而是真的开始接管这个项目了。
