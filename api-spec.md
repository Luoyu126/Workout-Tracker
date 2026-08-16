# 手机端球队管理 App API 设计文档

## 1. 文档基线

本文档定义 MVP 的 FastAPI REST API。

- 产品范围参见 [requirements.md](requirements.md)。
- 数据实体、字段、枚举和关系以 [database.md](database.md) 为唯一基线。
- 技术与测试约束参见 [tech_stack.md](tech_stack.md)。
- API JSON 字段统一使用 snake_case。
- API 不定义数据库基线之外的核心实体别名、角色或状态枚举。

## 2. 技术边界

- 移动端使用 Supabase Auth 完成注册、登录、刷新和退出。
- 移动端以 Bearer token 调用 FastAPI。
- FastAPI 验证 token，并通过 User.auth_id 查找或同步应用用户。
- FastAPI 是权限、状态流转、出勤、金币、库存和兑换的权威执行方。
- PostgreSQL 负责关系约束、事务和并发一致性。
- 对象存储用于头像、球队 logo 和商品图片。
- MVP 比赛看板使用短轮询，不要求 WebSocket。

## 3. 通用协议

### 3.1 Base URL

~~~text
/api/v1
~~~

### 3.2 认证头

~~~http
Authorization: Bearer <supabase_access_token>
~~~

除健康检查外，所有接口都要求有效访问令牌。

### 3.3 成功响应

MVP 使用 FastAPI 标准 JSON 响应：响应体直接是资源对象、资源数组或聚合对象。

例如 `GET /api/v1/teams` 直接返回 `TeamRead[]`，`GET /api/v1/teams/{team_id}/home` 直接返回 `TeamHomeRead`。

统一 envelope 可作为后续网关或 BFF 层扩展，不作为当前移动端与 FastAPI 的强制协议。

### 3.4 失败响应

MVP 使用 FastAPI 标准错误响应，业务错误在 `detail` 中返回结构化 code/message：

~~~json
{
  "detail": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found"
  }
}
~~~

### 3.5 HTTP 状态码

- 200：查询或更新成功。
- 201：创建成功。
- 204：删除成功，无响应体。
- 400：请求格式或业务规则错误。
- 401：未认证或 token 无效。
- 403：没有球队或资源权限。
- 404：资源不存在，或资源不属于当前可见范围。
- 409：唯一约束、状态流转或并发冲突。
- 422：字段校验失败。

### 3.6 分页

小队 MVP 的列表接口当前直接返回数组，并通过资源关系和状态过滤控制结果规模。

后续当列表规模增长时，再为高流量列表统一增加：

- cursor：上一页返回的游标。
- limit：默认 20，最大 100。

分页响应建议格式：

~~~json
{
  "items": [],
  "next_cursor": null
}
~~~

### 3.7 时间与标识符

- 所有 ID 都是 UUID。
- 所有时间使用带时区的 ISO 8601 UTC 字符串。
- 客户端只负责展示时转换为设备时区。
- 必填文本字段会在后端去除首尾空白；去除后为空的名称、标题、对手、公告内容等字段会被拒绝。

## 4. 权限模型

User 不保存全局业务角色。球队权限来自有效的 TeamMembership：

- member：读取球队内容、维护自己的报名、只读查看比赛实时看板、兑换商品。
- captain：包含 member 权限，并可管理活动、出勤、比赛实时记录、金币规则、商品和兑换履约。
- admin：包含 captain 权限，并可管理当前球队、成员和球队内角色。

所有 team_id、event_id、store_item_id 等资源都必须沿关系校验所属球队，禁止仅凭客户端传入的 team_id 授权。

首个组织、球队和管理员通过部署初始化脚本创建。MVP 中管理员权限限定在当前球队内，不提供组织级跨球队管理 API。

## 5. 规范资源模型

以下模型与 database.md 一一对应。响应可以附带聚合或关联对象，但不得改变基础字段含义。

### 5.1 User

~~~text
id
auth_id
name
student_id
email
avatar_url
status              # active | disabled
created_at
updated_at
~~~

User 响应不得包含认证服务密码、密码哈希或刷新令牌。

### 5.2 Organization

~~~text
id
name
slug
logo_url
created_at
updated_at
~~~

### 5.3 Team

~~~text
id
organization_id
name
description
logo_url
status              # active | archived
created_at
updated_at
~~~

队长列表和成员数由 TeamMembership 聚合，不保存为 Team 字段。

### 5.4 TeamMembership

~~~text
id
team_id
user_id
role                # member | captain | admin
jersey_number
position
status              # active | inactive | pending
joined_at
left_at
created_at
updated_at
~~~

同一 (team_id, user_id) 只能有一条记录。

### 5.5 Event

~~~text
id
team_id
type                # training | match | other
title
description
location
start_time
end_time
signup_deadline
status              # draft | published | completed | cancelled
created_by
created_at
updated_at
~~~

若提供 end_time，必须晚于 start_time；若提供 signup_deadline，不得晚于 start_time。创建和更新活动时，后端都会校验最终时间关系。

### 5.6 EventSignup

~~~text
id
event_id
user_id
user                # nullable UserSummary, 仅响应字段，便于移动端显示姓名/邮箱
status              # going | not_going | maybe
note
created_at
updated_at
~~~

同一 (event_id, user_id) 只能有一条记录。not_going 必须有非空 note。`user` 不在 EventSignup 表中冗余保存；报名列表和我的报名响应可由后端按 user_id 附带 UserSummary。

### 5.7 Attendance

~~~text
id
event_id
user_id
user                # nullable UserSummary, 仅响应字段，便于移动端显示姓名/邮箱
status              # present | late | absent | excused
recorded_by
recorded_at
note
created_at
updated_at
~~~

同一 (event_id, user_id) 只能有一条记录。`user` 不在 Attendance 表中冗余保存；出勤列表、出勤 upsert 响应和出勤榜可由后端按 user_id 附带 UserSummary。

### 5.8 MatchDetails

~~~text
id
event_id
opponent
team_score
opponent_score
result              # win | draw | loss
notes
created_at
updated_at
~~~

每场 match 最多一条 MatchDetails，training 和 other 不允许创建。

team_score 与 opponent_score 必须同时填写或同时为空；若填写 result，必须已填写双方比分，且 result 必须与比分一致。

### 5.9 MatchLogEntry

~~~text
id
event_id
entry_type          # goal | yellow_card | red_card | substitution
minute
player_name
player_number
sub_out_player_name
sub_out_player_number
sub_in_player_name
sub_in_player_number
created_by
created_at
updated_at
~~~

字段在数据库可空，但 API 根据 entry_type 做条件必填校验。

### 5.10 CoinRule

~~~text
id
team_id
name
trigger_type        # training_attendance | match_attendance | late_attendance | manual
amount
config
is_active
created_by
created_at
updated_at
~~~

### 5.11 CoinTransaction

~~~text
id
team_id
user_id
amount
type                # attendance_reward | redemption | admin_adjustment | other_reward | refund
reason
reference_type
reference_id
created_by
metadata
created_at
~~~

CoinTransaction 是不可静默修改的权威金币流水。

### 5.12 StoreItem

~~~text
id
team_id
name
description
image_url
price
stock
is_active
created_by
created_at
updated_at
~~~

stock 为 null 表示不限库存。

### 5.13 Redemption

~~~text
id
team_id
user_id
user                # nullable UserSummary, 仅响应字段，便于移动端显示兑换人
store_item_id
quantity
unit_price
total_price
status              # pending | fulfilled | cancelled | refunded
fulfilled_by
fulfilled_at
created_at
updated_at
~~~

`user` 不在 Redemption 表中冗余保存；兑换列表和管理列表可由后端按 user_id 附带 UserSummary。

### 5.14 Notification

~~~text
id
user_id
team_id
type                # new_event | event_updated | event_deleted | coin_earned | redemption_completed | team_announcement
title
body
reference_type
reference_id
read_at
created_at
expires_at
~~~

### 5.15 DeviceToken

~~~text
id
user_id
token
platform            # ios | android
is_active
last_seen_at
created_at
updated_at
~~~

## 6. 健康检查与身份 API

### 6.1 健康检查

GET /health

无需认证。只返回服务存活状态，不返回敏感配置。

### 6.2 同步当前用户

POST /api/v1/auth/sync

验证 Supabase token。若 auth_id 不存在则创建 User，若已存在则返回现有用户。

请求：

~~~json
{
  "name": "Tom",
  "student_id": null,
  "avatar_url": null
}
~~~

email 从认证 token 获取，不信任请求体中的 email。

### 6.3 当前用户

GET /api/v1/users/me

### 6.4 更新个人资料

PATCH /api/v1/users/me

允许更新：

~~~json
{
  "name": "Tom Chen",
  "student_id": "20260001",
  "avatar_url": "https://..."
}
~~~

客户端注册、登录、刷新和退出直接使用 Supabase Auth SDK，不由 FastAPI 保存密码。

## 7. 组织、球队与成员 API

### 7.1 我的组织

GET /api/v1/organizations

返回当前用户通过 active TeamMembership 可访问的组织。

### 7.2 我的球队

GET /api/v1/teams

支持 status 过滤，默认只返回 active 球队。

### 7.3 创建球队（后续能力）

MVP 不提供公开创建球队 API。部署初始化脚本创建首个 Team，并在同一事务中为初始用户创建 role=admin、status=active 的 TeamMembership。

后续多球队创建会作为组织级管理能力单独设计；当前移动端和 OpenAPI 客户端不应依赖 `POST /api/v1/organizations/{organization_id}/teams`。

### 7.4 球队主页

GET /api/v1/teams/{team_id}/home

返回 Team 基础字段以及派生数据：

- current_membership：当前用户在该球队的 active TeamMembership，用于前端判断 captain/admin UI 能力。
- captains：active captain 成员列表。
- member_count：active 成员数量。
- upcoming_events：近期 published 活动。
- attendance_summary：Attendance 聚合。
- coin_summary：CoinTransaction 聚合。

### 7.5 球队详情

GET /api/v1/teams/{team_id}

返回 Team 基础字段。当前用户必须是该球队 active 成员，且球队必须为 active。

### 7.6 更新球队

PATCH /api/v1/teams/{team_id}

captain 可更新 name、description、logo_url；admin 还可更新 status。

### 7.7 成员列表

GET /api/v1/teams/{team_id}/members

支持 role 和 status 过滤。

### 7.8 可添加成员候选

GET /api/v1/teams/{team_id}/member-candidates

仅 admin 可用。按姓名、邮箱或学号搜索已经同步、状态为 active、且尚未在当前球队拥有 TeamMembership 的用户。query 少于 2 个字符时返回空列表，避免把全局用户目录暴露给球队管理员。

查询参数：

- query：搜索关键词。
- limit：返回数量，默认 10，最大 25。

### 7.9 添加成员

POST /api/v1/teams/{team_id}/members

仅 admin 可用。`TeamMembership` 以 `(team_id, user_id)` 唯一。重复提交同一用户且 role、jersey_number、position、status 完全一致时，后端幂等返回已有 TeamMembership；同一用户被不同成员内容重复添加时返回 409。

~~~json
{
  "user_id": "6cab8c51-8697-4cb8-b956-27dfaf365b63",
  "role": "member",
  "jersey_number": "10",
  "position": "midfielder",
  "status": "active"
}
~~~

user_id 必须对应已经同步且 status=active 的 User；disabled 用户即使知道 UUID 也不能被直接添加为球队成员。

### 7.10 成员详情

GET /api/v1/teams/{team_id}/members/{user_id}

### 7.11 更新成员

PATCH /api/v1/teams/{team_id}/members/{user_id}

admin 可更新 role、status、jersey_number、position 和 left_at。更新后仍必须保证球队至少有一个 active admin。

## 8. 活动 API

### 8.1 创建训练或其他活动

POST /api/v1/teams/{team_id}/events

captain 或 admin 可用。客户端应生成 UUID `id` 并随请求提交。创建后状态固定为 draft，created_by 取当前用户。创建成功后为球队 active 成员创建 new_event Notification，通知内容保存活动标题和开始时间快照；但该通知使用 reference_type=event_snapshot 且 reference_id=null，避免普通队员通过通知打开仍不可见的 draft。重复提交相同 `id` 且 team、created_by 和 payload 完全一致时，后端幂等返回已有 Event，不重复创建活动或通知；相同 `id` 被不同请求复用时返回 409。type=match 必须使用创建比赛接口。

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "type": "training",
  "title": "Tuesday Training",
  "description": "Ball control",
  "location": "Main Field",
  "start_time": "2026-08-18T22:00:00Z",
  "end_time": "2026-08-19T00:00:00Z",
  "signup_deadline": "2026-08-18T16:00:00Z"
}
~~~

### 8.2 创建比赛

POST /api/v1/teams/{team_id}/matches

在同一事务中创建 Event(type=match, status=draft) 和 MatchDetails。客户端应在嵌套 `event` 中生成 UUID `id`。创建成功后为球队 active 成员创建 new_event Notification，通知内容保存比赛标题和开始时间快照；但该通知使用 reference_type=event_snapshot 且 reference_id=null，避免普通队员通过通知打开仍不可见的 draft。重复提交相同 `event.id` 且 team、created_by、event payload 和 match_details 完全一致时，后端幂等返回已有 Event，不重复创建 MatchDetails 或通知；相同 `event.id` 被不同请求复用时返回 409。

~~~json
{
  "event": {
    "id": "550e8400-e29b-41d4-a716-446655440011",
    "title": "League Match",
    "description": null,
    "location": "Main Field",
    "start_time": "2026-08-22T18:00:00Z",
    "end_time": "2026-08-22T20:00:00Z",
    "signup_deadline": "2026-08-21T18:00:00Z"
  },
  "match_details": {
    "opponent": "North FC",
    "notes": null
  }
}
~~~

opponent 必填且非空。

### 8.3 活动列表

GET /api/v1/teams/{team_id}/events

过滤参数：

- type：training | match | other
- status：draft | published | completed | cancelled
- starts_after
- starts_before

member 不可查看 draft；captain 和 admin 可以。

### 8.4 活动详情

GET /api/v1/events/{event_id}

match 响应附带 match_details。

### 8.5 更新活动

PATCH /api/v1/events/{event_id}

captain 或 admin 可用。仅 draft 或 published 可更新；completed 不可修改。type 创建后不可修改。比赛详情通过同一请求的 match_details 对象更新。更新 published 活动且实际字段发生变化后，为球队 active 成员创建 event_updated Notification；重复提交与当前状态完全一致的更新请求必须幂等返回当前 Event，不重复通知。

### 8.6 发布活动

POST /api/v1/events/{event_id}/publish

仅允许 draft → published。发布比赛前必须存在有效 MatchDetails 和 opponent。重复发布已 published 的活动必须幂等返回当前 Event，不得重复创建 new_event Notification。

成功后为球队 active 成员创建 new_event Notification，reference_type=event，reference_id=活动 id，可从通知打开活动详情。draft 修改不通知。

### 8.7 删除活动

DELETE /api/v1/events/{event_id}

captain 或 admin 可用。仅 draft 或 published 可删除；completed 不可删除。删除前后端锁定 Event 行，再决定是否通知和物理删除，避免并发删除/通知竞态。删除是物理删除 Event 以及 EventSignup、Attendance、MatchDetails、MatchLogEntry 等从属记录。删除 published 活动前，后端先为球队 active 成员创建 event_deleted Notification，通知内容必须保存活动标题和时间快照，不依赖删除后的 Event 外键。

### 8.8 完成活动

POST /api/v1/events/{event_id}/complete

captain 或 admin 可用。仅允许 published → completed。比赛活动的请求可包含最终比赛数据；训练或其他活动不得提交 match_details。

~~~json
{
  "match_details": {
    "team_score": 2,
    "opponent_score": 1,
    "result": "win",
    "notes": "Final"
  }
}
~~~

完成动作在一个事务中锁定 Event，为活动开始时有资格参与且缺失出勤的成员自动创建 absent Attendance，验证 Attendance，按球队 CoinRule 生成缺失的 attendance_reward CoinTransaction 和 coin_earned Notification，再更新 Event.status。有效成员范围按历史成员资格判断：`joined_at <= event.start_time`，且当前仍为 active 或 `left_at >= event.start_time`。活动后才加入的成员不会被自动补 absent；活动时仍在队但完成前离队的成员会被自动补 absent。

重复调用已 completed 的活动时返回现有结果，不重复发币。

## 9. 报名 API

### 9.1 我的报名

GET /api/v1/events/{event_id}/signup

若尚未创建记录，返回派生默认状态 maybe，但不强制插入数据库。
该接口遵守活动可见性：普通 member 不可通过 draft 活动 ID 读取报名状态。
响应包含 `user` 摘要，移动端可直接展示姓名/邮箱。

### 9.2 新建或修改报名

PUT /api/v1/events/{event_id}/signup

~~~json
{
  "status": "not_going",
  "note": "Unavailable"
}
~~~

规则：

- 仅 active 球队成员可操作自己的报名。
- 活动必须为 published。
- 当前时间不得超过有效报名截止时间；若 signup_deadline 为空，则以活动 start_time 作为截止时间。
- not_going 必须有非空 note。
- 使用 (event_id, user_id) 唯一约束做 upsert。

### 9.3 报名列表

GET /api/v1/events/{event_id}/signups

captain 或 admin 可用，支持 status 过滤。
响应中每条 EventSignup 包含 `user` 摘要，供队长在考勤页按姓名处理报名成员。

## 10. 出勤 API

### 10.1 出勤列表

GET /api/v1/events/{event_id}/attendance

member 可以读取；captain 和 admin 可以同时查看关联的报名意愿。
该接口遵守活动可见性：draft 活动仅 captain/admin 可读取，普通 member 即使知道 event_id 也不可读取。
响应中每条 Attendance 包含 `user` 摘要，供移动端显示姓名/邮箱；UUID 仅作为兜底展示和 API 路径标识。

### 10.2 新建或更新出勤

PUT /api/v1/events/{event_id}/attendance/{user_id}

captain 或 admin 可用。

~~~json
{
  "status": "present",
  "note": "Confirmed on site"
}
~~~

recorded_by 和 recorded_at 由后端设置。published 活动或新增 Attendance 时，目标用户必须是该活动球队的 active 成员。completed 活动中已有的 Attendance 可以继续被 captain/admin 修正，即使该成员后来变为 inactive，以支持历史奖励补发或追回；但不能为没有既有 Attendance 的 inactive 成员新建记录。

published 状态下的出勤参与完成结算；completed 状态下只能修正 Attendance，并按球队 CoinRule 补发或追回金币。若 present 或 late 改为 absent，后端创建负数 CoinTransaction 自动追回已发奖励，余额允许变为负数。
响应返回保存后的 Attendance，并附带目标成员的 `user` 摘要。

### 10.3 球队出勤榜

GET /api/v1/teams/{team_id}/attendance-board

仅统计 completed 活动，支持 starts_after、starts_before 参数。返回次数、present/late/absent/excused 数量、到场率等派生数据，并附带每名成员的 `user` 摘要用于移动端排行榜展示。

## 11. 比赛 API

### 11.1 新增实时记录

POST /api/v1/events/{event_id}/match-logs

仅 captain 或 admin 可用。Event 必须为 type=match、status=published。普通 member 可以读取实时看板，但不能新增比赛实时记录。

客户端应为每条实时记录生成 UUID `id` 并随请求提交。重复提交相同 `id` 且 payload 完全一致时，后端必须幂等返回已有 MatchLogEntry；相同 `id` 但 event、创建人或 payload 不一致时返回 409，避免现场网络重试造成重复进球/牌罚/换人记录。

进球或牌罚：

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "entry_type": "goal",
  "minute": 12,
  "player_name": "Alex",
  "player_number": "9"
}
~~~

换人：

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "entry_type": "substitution",
  "minute": 60,
  "sub_out_player_name": "Alex",
  "sub_out_player_number": "9",
  "sub_in_player_name": "Sam",
  "sub_in_player_number": "18"
}
~~~

minute 必须为非负整数。进球和牌罚要求 player_name、player_number；换人要求四个换人字段。

### 11.2 实时记录列表

GET /api/v1/events/{event_id}/match-logs

按 minute、created_at、id 稳定排序，支持 after 游标用于短轮询增量获取。
该接口遵守活动可见性：draft match 仅 captain/admin 可读取，普通 member 不可通过 event_id 读取。

### 11.3 删除实时记录

DELETE /api/v1/match-logs/{log_id}

仅 captain 或 admin 可用，且活动必须仍为 published。completed 或 cancelled 后记录只读。

### 11.4 实时看板

GET /api/v1/events/{event_id}/live-board

返回 Event、MatchDetails、按时间排序的 MatchLogEntry 以及由记录派生的事件计数。
该接口遵守活动可见性：draft match 仅 captain/admin 可读取。

### 11.5 比赛汇总

GET /api/v1/events/{event_id}/summary

仅适用于 match，返回比分、结果、四类记录统计、Attendance 和本活动 attendance_reward 流水。
该接口遵守活动可见性：draft match 仅 captain/admin 可读取。

## 12. 金币 API

### 12.1 球队金币余额

GET /api/v1/teams/{team_id}/coins/balance

当前用户余额为该 team_id 下 CoinTransaction.amount 的 SUM；无流水时为 0。

### 12.2 我的金币流水

GET /api/v1/teams/{team_id}/coins/transactions

支持 type、created_after、created_before 过滤。

### 12.3 成员金币流水

GET /api/v1/teams/{team_id}/members/{user_id}/coin-transactions

captain 或 admin 可用。

### 12.4 金币规则列表

GET /api/v1/teams/{team_id}/coin-rules

### 12.5 创建金币规则

POST /api/v1/teams/{team_id}/coin-rules

captain 或 admin 可用。客户端应生成 CoinRule UUID `id` 并随请求提交。重复提交相同 `id` 且 team、created_by 和 payload 完全一致时，后端幂等返回已有 CoinRule；相同 `id` 被不同规则内容复用时返回 409，避免网络重试重复创建训练/比赛/迟到奖励规则。

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440030",
  "name": "Match attendance",
  "trigger_type": "match_attendance",
  "amount": 20,
  "config": null,
  "is_active": true
}
~~~

### 12.6 更新金币规则

PATCH /api/v1/coin-rules/{coin_rule_id}

captain 或 admin 可用。

### 12.7 手工金币调整

POST /api/v1/teams/{team_id}/coin-transactions

admin 可用。客户端生成 transaction id，重试必须复用该 ID。同一个 transaction id 仅在
team_id、user_id、amount、type、reason 和 metadata 与原请求完全一致时幂等返回已有
CoinTransaction；任一字段不同必须返回 409 冲突，避免复用 id 掩盖客户端错误。

~~~json
{
  "id": "9960ead9-af05-4ce2-a926-5be36961c611",
  "user_id": "6cab8c51-8697-4cb8-b956-27dfaf365b63",
  "amount": 20,
  "type": "admin_adjustment",
  "reason": "Correction",
  "metadata": null
}
~~~

该接口只接受 admin_adjustment 或 other_reward。attendance_reward、redemption 和 refund 只能由对应业务流程创建。

## 13. 商店与兑换 API

### 13.1 商品列表

GET /api/v1/teams/{team_id}/store-items

member 只能看到 is_active=true 商品；即使显式传 is_active=false 也不会返回下架商品。captain 和 admin 可通过 is_active 参数筛选上架或下架商品，不传时查看全部。

### 13.2 商品详情

GET /api/v1/store-items/{store_item_id}

### 13.3 创建商品

POST /api/v1/teams/{team_id}/store-items

captain 或 admin 可用。客户端应生成 StoreItem UUID `id` 并随请求提交。重复提交相同 `id` 且 team、created_by 和 payload 完全一致时，后端幂等返回已有 StoreItem；相同 `id` 被不同请求复用时返回 409，避免网络重试重复上架同一商品。

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "name": "Team Jersey",
  "description": "Home jersey",
  "image_url": null,
  "price": 500,
  "stock": 20,
  "is_active": false
}
~~~

price 必须大于 0；stock 为 null 或非负整数。

### 13.4 更新商品

PATCH /api/v1/store-items/{store_item_id}

captain 或 admin 可用。

### 13.5 创建兑换

POST /api/v1/teams/{team_id}/redemptions

客户端生成 Redemption UUID；网络重试复用同一个 id。

~~~json
{
  "id": "8fd6f8d0-6b2a-4a0c-9f7a-2a3d7f4a2a0a",
  "store_item_id": "f966b8c4-3d1e-4e14-8e72-1134db078835",
  "quantity": 1
}
~~~

服务端在一个事务内：

1. 以 id 检查是否已有 Redemption；仅当已有记录属于同一用户、同一球队、
   同一商品且数量一致时返回原结果。若同一 id 被不同请求内容复用，返回冲突，
   且不得扣金币或修改库存。
2. 锁定 StoreItem。
3. 从 CoinTransaction 汇总余额。
4. 校验商品属于 team_id、已上架、余额和库存足够。
5. 以当前 StoreItem.price 写入 unit_price 和 total_price。
6. 创建 pending Redemption。
7. 创建负数、type=redemption 的 CoinTransaction。
8. 扣减有限库存并提交。

客户端不得提交价格、总价或金币扣减金额。

### 13.6 我的兑换记录

GET /api/v1/teams/{team_id}/redemptions

仅返回当前用户订单，支持 status 过滤。响应中每条 Redemption 包含 `user` 摘要。

### 13.7 球队兑换订单

GET /api/v1/teams/{team_id}/redemptions/manage

captain 或 admin 可用。响应中每条 Redemption 包含 `user` 摘要，供管理端显示兑换人姓名/邮箱。

### 13.8 完成履约

POST /api/v1/redemptions/{redemption_id}/fulfill

仅允许 pending → fulfilled。后端填写 fulfilled_by、fulfilled_at，并创建 redemption_completed Notification。重复履约已 fulfilled 的兑换单必须幂等返回当前 Redemption，不得重复创建 redemption_completed Notification。

### 13.9 取消待处理兑换

POST /api/v1/redemptions/{redemption_id}/cancel

仅允许 pending → cancelled。在同一事务中创建正数 refund CoinTransaction 并恢复有限库存。重复取消已 cancelled 的兑换单必须幂等返回当前 Redemption，不得创建第二笔 refund 或重复恢复库存。

### 13.10 退款已履约兑换

POST /api/v1/redemptions/{redemption_id}/refund

仅允许 fulfilled → refunded。在同一事务中创建正数 refund CoinTransaction，并恢复有限库存。重复退款已 refunded 的兑换单必须幂等返回当前 Redemption，不得创建第二笔 refund 或重复恢复库存。

对非对应终态的跨状态错误操作仍返回冲突，例如 fulfilled 不能取消，pending 不能退款，cancelled 不能退款。

## 14. 通知与设备 API

### 14.1 通知列表

GET /api/v1/notifications

只返回当前用户的 Notification，支持 team_id、type、unread_only 过滤。

### 14.2 标记已读

POST /api/v1/notifications/{notification_id}/read

后端写入 read_at；重复调用返回现有结果。

### 14.3 未读数

GET /api/v1/notifications/unread-count

支持可选 team_id。

### 14.4 发布球队公告

POST /api/v1/teams/{team_id}/announcements

captain 或 admin 可用。客户端应生成公告 UUID `id` 并随请求提交。创建后立即为当前球队 active 成员创建 `team_announcement` Notification，`reference_type=team_announcement`，`reference_id=id`。重复提交相同 `id` 且 title/body 完全一致时，后端幂等返回已有通知，不重复创建 Inbox 或 Push；相同 `id` 被不同公告内容复用时返回 409。

请求：

~~~json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "title": "今晚训练",
  "body": "19:00 准时到球场集合。"
}
~~~

响应：201，返回创建的 Notification 数组。

### 14.5 注册设备

PUT /api/v1/device-tokens

~~~json
{
  "token": "ExponentPushToken[...]",
  "platform": "ios"
}
~~~

按 token 唯一约束创建或更新，并设置 is_active=true、last_seen_at=当前时间。token 会去除首尾空白，且必须匹配 `ExponentPushToken[...]` 格式。

### 14.6 停用设备

DELETE /api/v1/device-tokens/{device_token_id}

不物理删除，设置 is_active=false。

## 15. 状态流转

### 15.1 Event

~~~text
draft → published → completed

draft/published → hard delete
~~~

- draft 仅 captain/admin 可见和编辑；删除 draft 不通知。
- published 可报名；重复发布必须幂等返回，不重复发送发布通知；captain/admin 可在 published match 新增或删除实时记录，member 只能只读查看实时看板；实际修改 published 后通知队员，重复提交相同更新不重复通知；删除 published 先通知再物理删除。
- completed 的报名、比赛记录和活动安排只读；不可修改或删除活动；赛后修正 Attendance 会补发或追回金币。
- cancelled 保留为数据库枚举值，但 MVP 的活动删除不使用 cancelled 状态。

### 15.2 Redemption

~~~text
pending → fulfilled → refunded
   │
   └────────→ cancelled
~~~

- pending 创建时已经扣币并预留库存。
- fulfilled 重复履约必须幂等返回，不重复发送履约通知。
- cancelled 必须以补偿性 refund 流水返币并恢复库存；重复取消幂等返回，不重复补偿。
- refunded 必须以补偿性 refund 流水返币并恢复有限库存，不编辑原 redemption 流水；重复退款幂等返回，不重复补偿。

## 16. 数据一致性约束

- 所有写接口必须重新校验 active TeamMembership 和资源所属球队。
- EventSignup 和 Attendance 必须保持独立。
- CoinTransaction 只追加，不提供通用修改或删除接口。
- attendance_reward 对同一球队、用户和活动只能存在一次。
- MatchDetails 只能属于 match Event，且 event_id 唯一。
- 兑换使用客户端生成的 Redemption.id 实现安全重试。
- 余额、库存、订单和退款相关写入必须使用 PostgreSQL 事务和行锁。
- 通知推送失败不影响 Notification 以及核心业务事务。

## 17. 上传约定

移动端通过存储服务 SDK 或受控签名 URL 直传文件。上传完成后，只把可访问的 URL 写入以下数据库字段：

- User.avatar_url
- Organization.logo_url
- Team.logo_url
- StoreItem.image_url

FastAPI 只接受允许的文件类型、大小和当前用户有权写入的资源 URL。

## 18. OpenAPI 与客户端

- FastAPI 生成 OpenAPI 文档。
- packages/api-client 从 OpenAPI 自动生成 TypeScript 客户端。
- CI 检查 OpenAPI 是否能生成并验证响应模型。
- 枚举值从服务端规范生成，移动端不得手写另一套别名。
