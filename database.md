# 数据库设计 — Team Management App

## 1. 设计原则

数据库需要支撑当前移动端应用，并用关系型结构表达以下能力：

* 多个球队
* 多个组织
* 用户加入多个球队
* 球队内角色
* 活动报名记录
* 比赛记录
* 可配置金币奖励
* 可审计金币流水
* 球队内商店
* 移动端通知

核心原则：

> **为未来设计数据模型，为当前实现建设基础设施。**

数据库应保持关系清晰、字段明确，并且便于理解和维护。

---

# 2. 实现概要

本数据库设计以 `requirements.md` 为业务基线，包含 14 个核心实体，并通过现有实体表达入队申请、活动报名、比赛记录、金币流水、商品兑换和通知投递等产品流程。核心实现约定如下：

1. **入队申请由 `TeamMembership` 表达**：用户提交申请时创建或复用一条 `role=member`、`status=pending` 的成员关系；管理员批准后转为 `active`，拒绝后转为 `inactive`。
2. **球队角色包含两种**：系统角色为 `member` 和 `admin`。业务上的真实球队队长使用 `member`；`admin` 负责管理，不参与报名、报名统计或活动奖励。
3. **活动状态包含两种**：`Event.status` 只使用 `published` 和 `completed`。管理员填写活动表单期间不写入数据库；点击发布后才创建 `published` 活动，活动到达 `end_time` 后由后端自动转为 `completed`。
4. **活动完成按报名结算**：系统不维护独立出勤实体；活动完成时仅对符合资格且报名为 `going` 的队员生成 `signup_reward`。
5. **比赛记录受生命周期约束**：仅管理员可对已经开始且处于 `published` 状态的比赛写入或删除四类实时记录；活动完成后比赛记录只读。
6. **金币与兑换具备幂等性**：报名奖励、兑换扣币、取消和退款补偿均通过唯一引用和数据库事务避免重复入账、重复扣币或重复恢复库存。
7. **活动通知以事件为引用源**：活动发布入库时为有效队员创建 `new_event`；活动修改同步既有通知内容，活动删除撤销对应通知。
8. **成员信息记录球队内展示数据**：`TeamMembership.player_name` 存储队内展示名；`joined_at` 可为空，因为 `pending` 或从未批准的 `inactive` 申请尚无正式入队时间。
9. **兑换处理记录完整审计信息**：`Redemption` 记录履约、取消、退款对应的操作者和时间，保证状态变化可追踪。

---

# 3. 完整领域模型

```text
Organization
│
└── Team
    │
    ├── TeamMembership ───────────── User
    │
    ├── Event
    │   ├── EventSignup ──────────── User
    │   └── MatchDetails
    │   └── MatchLogEntry ────────── User
    │
    ├── CoinRule
    ├── CoinTransaction ──────────── User
    │
    ├── StoreItem
    │   └── Redemption ───────────── User
    │
    └── Notification ─────────────── User

User
└── DeviceToken
```

数据库包含 14 个主要实体：

1. `User`
2. `Organization`
3. `Team`
4. `TeamMembership`
5. `Event`
6. `EventSignup`
7. `MatchDetails`
8. `MatchLogEntry`
9. `CoinRule`
10. `CoinTransaction`
11. `StoreItem`
12. `Redemption`
13. `Notification`
14. `DeviceToken`

---

# 4. User

表示一个应用账号。

用户独立于任何球队存在。

```text
User
├── id                  UUID, PK
├── auth_id             UUID, UNIQUE
├── name                string
├── student_id          string, nullable
├── email               string, UNIQUE
├── avatar_url          string, nullable
├── status              enum
├── created_at          timestamp
└── updated_at          timestamp
```

> auth_id是在Supabase Auth那里的认证数据库里对应user的id，业务数据库里不负责认证逻辑

### 状态

```text
active
disabled
```

### 重要规则

`id` 是应用内部身份标识。

`student_id` 不能作为主键。

用户可以没有学号，因为后续用户类型可能包括教练、校友、外部成员，或来自其他组织类型的用户。

---

# 5. Organization

表示一个大学、俱乐部或其他包含球队的组织。

```text
Organization
├── id                  UUID, PK
├── name                string
├── slug                string, UNIQUE
├── logo_url            string, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

关系：

```text
Organization 1 ─── N Team
```

---

# 6. Team

表示产品中的主要组织单元。

```text
Team
├── id                  UUID, PK
├── organization_id     UUID, FK → Organization
├── name                string
├── description         text, nullable
├── logo_url            string, nullable
├── status              enum
├── created_at          timestamp
└── updated_at          timestamp
```

### 状态

```text
active
archived
```

`member`、`admin` 这类角色不能直接存储在 `Team` 上。

`Team.name` 不要求全局唯一，因为不同组织可以使用相同球队名称。应增加大小写不敏感的搜索索引；如果数据库支持，也可以增加 trigram 索引。用户按球队名称搜索时，结果只应包含 `status=active` 的球队。

---

# 7. TeamMembership

表示：

```text
User × Team
```

```text
TeamMembership
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── role                enum
├── jersey_number       string, nullable
├── player_name         string, nullable
├── status              enum
├── joined_at           timestamp, nullable
├── left_at             timestamp, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### 角色

```text
member
admin
```

### 状态

```text
active
inactive
pending
```

> 申请入队的时候是pending

### 约束

```text
UNIQUE(team_id, user_id)
```

一个用户可以加入多个球队，但在同一个球队中最多只有一条成员关系。

球队内属性存储在这里。`player_name` 可以默认使用 `User.name`，但当球队需要独立展示名时，应存储在 `TeamMembership` 上。

> 在每个队可以有一个不同的名

### 入队申请与状态流转

```text
无成员关系 ──申请────> pending
inactive ───重新申请─> pending
pending ────批准────> active
pending ────拒绝────> inactive
active ─────停用────> inactive
```

规则：

* 用户申请入队时创建 `role=member`、`status=pending` 的记录。
* 重新申请会复用已有 `inactive` 记录，将角色重置为 `member`，并将状态改为 `pending`。
* `pending` 和 `inactive` 成员不能访问球队私有数据、报名活动、获得报名奖励、兑换商品或执行球队管理操作。
* 批准申请会将 `pending` 改为 `active`；`joined_at` 设置为当前批准时间，并清空 `left_at`。
* 拒绝申请会将 `pending` 改为 `inactive`。停用一个 `active` 成员时设置 `left_at`。
* 只有同一球队中的 `active` `admin` 成员可以批准、拒绝、修改角色或停用成员关系。
* 重复执行已经生效的状态流转时，应返回当前记录，不能创建新的成员关系。

推荐检查：

```text
status = active  → joined_at 非空
status = pending → role = member
```

示例：

```text
User: Yunyi Chen

Football Team
├── role = member
├── jersey_number = 10
└── player_name = Yunyi

Basketball Team
├── role = member
├── jersey_number = 23
└── player_name = Chen Yunyi
```

---

# 8. Event

表示球队活动。

```text
Event
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── type                enum
├── title               string
├── description         text, nullable
├── location            string
├── start_time          timestamp
├── end_time            timestamp
├── status              enum
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### 类型

```text
training
match
other
```

### 状态

```text
published
completed
```

训练和比赛不应在初始设计中建成完全独立的两套活动系统。

### 活动规则

* `end_time` 必填，并且必须晚于 `start_time`。
* 管理员填写活动表单期间不创建 `Event` 记录；只有点击发布后，后端才创建 `status=published` 的活动。
* 创建 `type=training` 或 `type=match` 的活动前，后端必须确认当前球队已有对应的 `active` `CoinRule`：`training` 需要 `training_signup`，`match` 需要 `match_signup`。缺少对应规则时拒绝创建活动，并要求管理员先配置金币规则。
* 只有球队 `active` `admin` 可以创建、更新或物理删除 `published` 活动。
* 允许的状态流是 `published → completed`。
* 活动到达 `end_time` 后，由后端定时任务或等效机制自动将状态转为 `completed`，并在同一结算流程中自动处理报名奖励和完成通知，不需要管理员确认。
* 只有 `published` 活动可以物理删除。`completed` 活动不可变，并且必须保留，因为金币流水可能引用它。
* 创建活动时使用客户端提供的 UUID `id` 作为幂等键。使用同一个 ID 且内容一致时返回已有活动；使用同一个 ID 但内容不一致时视为冲突。

---

# 9. EventSignup

表示：

> **该用户是否计划参加这个活动？**

```text
EventSignup
├── id                  UUID, PK
├── event_id            UUID, FK → Event
├── user_id             UUID, FK → User
├── status              enum, default maybe
├── note                text, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### 状态

```text
going
not_going
maybe
```

### 约束

```text
UNIQUE(event_id, user_id)
```

概念上：

```text
EventSignup = 计划参与状态
```

规则：

* 新报名默认是 `maybe`。
* `not_going` 必须填写非空 `note`。
* 只有在活动所属球队中拥有 `active` `role=member` 成员关系的用户可以创建或更新报名。球队管理员明确不具备报名资格。
* 只有当活动处于 `published` 时，才允许修改报名。
* 活动进入 `completed` 后，报名不可变。
* 完成活动时，没有 `EventSignup` 记录的成员按 `maybe` 处理；系统不会为缺席或出勤额外插入记录。

---

# 10. MatchDetails

存储比赛活动的补充信息。

仅当以下条件成立时存在：

```text
Event.type = match
```

```text
MatchDetails
├── id                  UUID, PK
├── event_id            UUID, FK → Event, UNIQUE
├── opponent            string
├── team_score          integer, nullable
├── opponent_score      integer, nullable
├── result              enum, nullable
├── notes               text, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### 结果

```text
win
draw
loss
```

概念上：

```text
Event
│
├── training
│
└── match
     └── MatchDetails
```

`MatchDetails` 表示比赛级别的元数据和结果。

产品支持进球、牌和换人的实时比赛记录，因此需要 `MatchLogEntry`。

规则：

* `MatchDetails` 只能存在于父级 `Event.type=match` 的活动下；训练和其他活动不能拥有该记录。
* 创建 `type=match` 的活动时，`opponent` 必须非空。
* `team_score` 和 `opponent_score` 要么都为空，要么都非空；非空分数必须是非负数。
* 当分数存在时，`result` 必须与比分一致：本队得分更高为 `win`，相等为 `draw`，更低为 `loss`。
* 比赛和活动一起创建时，使用嵌套的客户端 `event.id` 保证请求幂等；重试不能创建第二条 `MatchDetails`。

---

# 11. MatchLogEntry

表示比赛进行中的实时记录。

```text
MatchLogEntry
├── id                  UUID, PK
├── event_id            UUID, FK → Event
├── entry_type          enum
├── minute              integer
├── player_name         string, nullable
├── player_number       string, nullable
├── sub_out_player_name string, nullable
├── sub_out_player_number string, nullable
├── sub_in_player_name  string, nullable
├── sub_in_player_number string, nullable
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### 记录类型

```text
goal
yellow_card
red_card
substitution
```

`MatchLogEntry` 是 `Event` 的一对多子记录，用于支持实时比赛记录功能。

### 字段与生命周期规则

* `id` 是客户端提供的 UUID，也是幂等键。相同 ID 且请求内容相同返回已有记录；相同 ID 但内容不同视为冲突。
* `minute` 必填，并且必须是非负整数。
* 对于 `goal`、`yellow_card` 和 `red_card`，`player_name` 与 `player_number` 必填；所有换人字段必须为空。
* 对于 `substitution`，所有 `sub_out_*` 与 `sub_in_*` 的姓名和号码字段必填；单人字段必须为空。
* 创建记录前，父级活动必须满足 `type=match`、`status=published` 且 `start_time <= now()`。
* `created_by` 必须是在活动所属球队中拥有 `active` `role=admin` 成员关系的用户。普通成员只能读取实时记录。
* 只有 `active` 球队管理员可以删除记录，并且只能在比赛处于 `published` 时删除。
* 活动进入 `completed` 后，实时记录不可变；记录不支持就地编辑。

---

# 12. CoinRule

表示决定何时发放金币的可配置规则。

```text
CoinRule
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── name                string
├── trigger_type        enum
├── amount              integer
├── config              JSON, nullable
├── is_active           boolean
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

### 初始触发类型

```text
training_signup
match_signup
manual
```

示例：

```text
训练报名 going → +10
比赛报名 going → +20
```

概念上：

```text
CoinRule
=
条件 → 奖励
```

奖励金额不能硬编码在移动端前端中。

后端负责评估适用规则。

规则：

* `amount` 必须大于或等于 0。0 是有效配置，但不会产生正向余额变化。
* `created_by` 必须是在同一球队中拥有 `active` `role=admin` 成员关系的用户。
* 每个球队最多只能有一条 `active` 的 `training_signup` 规则和一条 `active` 的 `match_signup` 规则。应使用部分唯一索引强制约束。
* 活动自动完成时，后端根据 `Event.type` 自动选择对应的 `active` 规则进行结算：`training` 使用 `training_signup`，`match` 使用 `match_signup`。由于发布前已经强制检查对应规则，自动结算不需要等待管理员选择规则。
* `manual` 用于管理员手动发放奖励或调整，也可以通过 `config` 存储经过后端验证和文档化的条件。
* `id` 由客户端提供，用于幂等创建。相同 ID 且请求内容一致时返回已有规则；相同 ID 但请求内容不一致时视为冲突。

---

# 13. CoinTransaction

表示用户金币余额的每一次实际变化。

这是权威金币账本。

```text
CoinTransaction
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── amount              integer
├── type                enum
├── reason              string, nullable
├── reference_type      string, nullable
├── reference_id        UUID, nullable
├── created_by          UUID, FK → User, nullable
├── metadata            JSON, nullable
└── created_at          timestamp
```

### 类型

```text
signup_reward
redemption
admin_adjustment
other_reward
refund
```

示例：

```text
+10   训练报名奖励
+10   训练报名奖励
+20   比赛报名奖励
-30   商店兑换
--------------------------------
余额 = 10
```

权威余额计算方式：

```text
Balance(user, team)
=
SUM(CoinTransaction.amount)
```

金币在概念上属于：

```text
User × Team
```

因此：

```text
Yunyi
├── Football Team    120 coins
└── Basketball Team   40 coins
```

该模型**不**把金币视为用户的全局余额。

同一个 `(team_id, user_id, event)` 对应的 `signup_reward` 必须唯一。

同一个 `(team_id, user_id, redemption)` 对应的 `refund` 必须唯一。

不要在 `User` 上存储权威且可变的 `coin_balance`。

如果后续性能需求需要，可以再引入缓存余额。

### 账本约束

推荐引用约定：

```text
signup_reward   → reference_type = event,      reference_id = Event.id
redemption      → reference_type = redemption, reference_id = Redemption.id
refund          → reference_type = redemption, reference_id = Redemption.id
```

推荐部分唯一索引：

```text
UNIQUE(team_id, user_id, reference_id)
  WHERE type = signup_reward AND reference_type = event

UNIQUE(team_id, user_id, reference_id)
  WHERE type = redemption AND reference_type = redemption

UNIQUE(team_id, user_id, reference_id)
  WHERE type = refund AND reference_type = redemption
```

补充规则：

* 自动 `signup_reward` 只发给符合以下条件的 `active` `member`：在 `Event.start_time` 前已经 `active`、完成结算时仍然 `active`，并且 `EventSignup.status=going`。管理员永远不会获得该奖励。
* 活动自动完成、创建所有符合条件的奖励流水、创建对应通知，必须在一个幂等数据库事务中完成。
* `redemption` 金额必须为负数。`refund`、`signup_reward` 和 `other_reward` 金额必须为非负数。`admin_adjustment` 可以为正数或负数，也可以让结果余额变为负数。
* 奖励和调整目标必须使用 `role=member` 的球队成员关系；退款可以在原兑换用户的成员关系变为 `inactive` 后继续退回给该用户。球队管理员不通过成员流程获得或兑换球队金币。
* 自动结算时 `created_by` 为空；手动调整、其他手动奖励、兑换履约补偿、取消或退款等动作中，`created_by` 存储执行操作的 `active` 球队管理员。
* 已有账本记录只追加不修改。更正错误时使用补偿交易，而不是修改或删除历史记录。

---

# 14. StoreItem

表示用户可用球队金币兑换的商品。

```text
StoreItem
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── name                string
├── description         text, nullable
├── image_url           string, nullable
├── price               integer
├── stock               integer, nullable
├── is_active           boolean
├── created_by          UUID, FK → User
├── created_at          timestamp
└── updated_at          timestamp
```

示例：

```text
Team Jersey       500 coins
Sports Drink       30 coins
Team Sticker       20 coins
```

`stock = NULL` 可以表示无限库存。

`price` 必须为正数。

`stock` 存在时必须为非负数。

只有 `active` 球队 `admin` 可以创建或更新商品。客户端提供 UUID `id` 用于幂等创建：相同内容的重复请求返回已有商品；相同 ID 但内容不同视为冲突。

---

# 15. Redemption

表示用户发起的一次实际兑换交易。

```text
Redemption
├── id                  UUID, PK
├── team_id             UUID, FK → Team
├── user_id             UUID, FK → User
├── store_item_id       UUID, FK → StoreItem
├── quantity            integer
├── unit_price          integer
├── total_price         integer
├── status              enum
├── fulfilled_by        UUID, FK → User, nullable
├── fulfilled_at        timestamp, nullable
├── cancelled_by        UUID, FK → User, nullable
├── cancelled_at        timestamp, nullable
├── refunded_by         UUID, FK → User, nullable
├── refunded_at         timestamp, nullable
├── created_at          timestamp
└── updated_at          timestamp
```

### 状态

```text
pending
fulfilled
cancelled
refunded
```

历史购买价格必须保留。

`quantity`、`unit_price` 和 `total_price` 必须为正数。

`total_price` 必须等于 `quantity × unit_price`。

示例：

```text
StoreItem.price = 50

用户兑换商品
→ Redemption.unit_price = 50

之后：
StoreItem.price = 100

历史 Redemption.unit_price 仍然是 50
```

一次成功兑换通常会创建：

```text
Redemption
        +
CoinTransaction(-total_price)
        +
库存扣减
```

这些操作必须在一个数据库事务中完成：

```text
全部成功
     或
全部失败
```

### 状态与补偿规则

```text
pending ──履约──> fulfilled
pending ──取消──> cancelled
fulfilled ─退款─> refunded
```

* 只有在同一球队中拥有 `active` `role=member` 成员关系的用户可以创建兑换。管理员、`pending` 用户和 `inactive` 用户没有兑换资格。
* 被引用的 `StoreItem` 必须属于同一球队，并且 `is_active=true`。
* 创建兑换时，系统原子性检查账本余额和库存，创建 `Redemption(status=pending)`，写入一条负数 `CoinTransaction(type=redemption)`，并扣减有限库存。
* 兑换交易金额必须等于 `-Redemption.total_price`；取消和退款补偿金额必须等于 `+Redemption.total_price`。流水中的用户和球队引用必须与兑换记录一致。
* 余额检查和有限库存更新必须锁定相关行，或使用等效并发控制，避免并发请求导致超额消费或超卖。
* `active` 球队 `admin` 可以履约或取消 `pending` 兑换，也可以对 `fulfilled` 兑换退款。
* 取消操作原子性地将状态改为 `cancelled`，写入一条正数 `refund` 流水，并恢复有限库存。
* 退款操作原子性地将状态改为 `refunded`，并写入一条正数 `refund` 流水。由于 `fulfilled` 商品已经离开库存，退款不会自动恢复库存。
* 重复履约、取消或退款时，应返回当前结果，不能生成第二条通知、退款或库存变化。
* 客户端提供的 UUID `id` 用于保证兑换创建幂等；相同 ID 但内容不同视为冲突。

状态专属检查应确保只有实际发生的状态流转才会填充对应操作者和时间字段。

```text
pending   → 所有 fulfilled/cancelled/refunded 操作者和时间字段为空
fulfilled → fulfilled_by 和 fulfilled_at 非空
cancelled → cancelled_by 和 cancelled_at 非空；fulfil/refund 字段为空
refunded  → fulfilled_by/at 和 refunded_by/at 非空；cancel 字段为空
```

---

# 16. Notification

表示发送给单个用户的一条站内通知。

```text
Notification
├── id                  UUID, PK
├── user_id             UUID, FK → User
├── team_id             UUID, FK → Team
├── type                enum
├── title               string
├── body                text
├── reference_type      string, nullable
├── reference_id        UUID, nullable
├── read_at             timestamp, nullable
├── created_at          timestamp
├── updated_at          timestamp
└── expires_at          timestamp, nullable
```

可用类型：

```text
new_event
coin_earned
redemption_completed
team_announcement
```

通知属于单个用户，因此已读和未读状态可以独立追踪。

### 投递与幂等规则

* `Notification` 是权威站内收件箱来源；推送投递只是尽力而为的副作用。
* 活动发布入库时，为球队中每个 `active` `member` 创建一条 `new_event` 通知。不要通过 `new_event` 通知管理员。
* 发布入库是活动创建通知的唯一时机。已发布活动发生实际更新时，应同步更新既有 `new_event` 通知的 `title`/`body` 快照，而不是创建新的通知类型。
* 物理删除 `published` 活动时，也要在同一事务中删除对应的 `new_event` 通知，因为通知引用是多态引用而不是外键。
* 活动自动完成结算时，为每个获得奖励的成员创建 `coin_earned`。管理员不会因为自动结算获得金币流水或金币余额变化。
* 履约兑换时，为兑换用户创建一条 `redemption_completed` 通知。重复履约不能创建重复通知。
* 球队公告使用客户端提供的公告 UUID 作为 `reference_id`，并为每个 `active` `member` 创建一条 `team_announcement`。除非之后增加单独产品规则，管理员不属于“有效队员”接收范围。
* 对于带引用的通知，应使用等价于 `UNIQUE(user_id, type, reference_id)` 且 `reference_id IS NOT NULL` 的唯一键保证幂等。

推荐引用：

```text
new_event             → reference_type = event,            reference_id = Event.id
coin_earned (member)  → reference_type = coin_transaction, reference_id = CoinTransaction.id
redemption_completed  → reference_type = redemption,       reference_id = Redemption.id
team_announcement     → reference_type = announcement,     reference_id = client announcement UUID
```

---

# 17. DeviceToken

表示一台可以接收推送通知的移动设备。

```text
DeviceToken
├── id                  UUID, PK
├── user_id             UUID, FK → User
├── token               string, UNIQUE
├── platform            enum
├── is_active           boolean
├── last_seen_at        timestamp
├── created_at          timestamp
└── updated_at          timestamp
```

### 平台

```text
ios
android
```

一个用户可以拥有多台设备。

因此，推送 token 不应作为单一字段直接存储在 `User` 上。

推送失败不能回滚创建站内通知的业务事务。失败或过期的 token 可以标记为 `is_active=false`。

---

# 18. 完整关系模型

```text
Organization 1 ───── N Team

User 1 ───────────── N TeamMembership
Team 1 ───────────── N TeamMembership

Team 1 ───────────── N Event
User 1 ───────────── N Event              (created_by)

Event 1 ──────────── N EventSignup
User 1 ───────────── N EventSignup

Event 1 ─────────── 0..1 MatchDetails
Event 1 ──────────── N MatchLogEntry
User 1 ───────────── N MatchLogEntry       (created_by)

Team 1 ───────────── N CoinRule
User 1 ───────────── N CoinRule            (created_by)

User 1 ───────────── N CoinTransaction     (recipient)
Team 1 ───────────── N CoinTransaction
User 1 ───────────── N CoinTransaction     (created_by, nullable)

Team 1 ───────────── N StoreItem
User 1 ───────────── N StoreItem           (created_by)

User 1 ───────────── N Redemption          (redeemer)
Team 1 ───────────── N Redemption
StoreItem 1 ──────── N Redemption
User 1 ───────────── N Redemption          (fulfilled/cancelled/refunded by)

User 1 ───────────── N Notification
Team 1 ───────────── N Notification

User 1 ───────────── N DeviceToken
```

### 外键与删除策略

* 用户、组织、球队、成员关系、金币账本、兑换和通知历史应使用 `RESTRICT` 或归档策略，而不是破坏性级联删除。
* 物理删除符合条件的 `published` 活动时，可以级联删除 `EventSignup`、`MatchDetails` 和 `MatchLogEntry`；对应的 `new_event` 通知需要在同一事务中显式删除，因为通知引用是多态引用而不是外键。
* 禁止删除已有历史兑换记录引用的 `StoreItem`。商品下架应使用 `is_active=false`。
* 球队归档使用 `Team.status=archived`，而不是删除球队。

---

# 19. 核心产品流程

主要应用闭环是：

```text
Team
 │
 ▼
Event
 │
 ├──── EventSignup
 │
 │ 评估
 ▼
CoinRule
 │
 ▼
CoinTransaction (+)
 │
 ▼
金币余额
 │
 ▼
StoreItem
 │
 ▼
Redemption
 │
 ▼
CoinTransaction (-)
```

该流程表达的核心产品循环是：

```text
参与活动
    ↓
记录行为
    ↓
获得奖励
    ↓
积累金币
    ↓
兑换奖励
    ↓
鼓励参与
```

---

# 20. 核心领域骨架

架构上最重要的实体是：

```text
User
Organization
Team
TeamMembership
Event
EventSignup
CoinRule
CoinTransaction
StoreItem
Redemption
```

`MatchDetails`、`MatchLogEntry`、`Notification` 和 `DeviceToken` 是围绕核心模型的支撑扩展。

---

# 21. 重要数据库不变量

## 身份

* `User.id` 是内部身份标识。
* `student_id` 是外部档案信息。
* 用户独立于球队存在。

## 成员关系

* 用户可以加入多个球队。
* 一个用户在一个球队中最多只有一条成员关系。
* 角色是球队内属性，并且只包含 `member` 和 `admin`。
* 已提交的入队申请是一条 `pending` 成员关系，不是独立实体。
* 只有 `active` 成员关系可以授权访问球队私有内容或执行业务操作。
* `admin` 账号仅用于管理；现实中的球队队长使用 `member` 账号。
* 成员批准、拒绝、重新申请、角色变更和停用都应幂等更新已有唯一记录。

## 活动

* 每个活动属于一个球队。
* 一个用户对一个活动最多只有一条报名记录。
* 活动状态只包含 `published` 和 `completed`。
* 只有 `active` `member` 用户可以创建 `EventSignup` 记录、出现在报名面板中，或获得报名奖励。
* `active` `admin` 用户管理活动，但不能报名、出现在报名统计中，或获得报名奖励。
* `not_going` 需要理由；缺失报名按 `maybe` 处理，不创建独立出勤记录。
* `MatchDetails` 只存在于比赛活动。
* `MatchLogEntry` 只属于已经开始且 `published` 的比赛，并且只能由 `active` 管理员写入或删除。
* 已完成的活动、报名、比赛详情和比赛记录不可变。

## 金币

* 金币属于 `(user, team)`。
* 每次余额变化都创建一条 `CoinTransaction`。
* 后端决定奖励金额。
* 前端永远不能提交权威金币金额。
* 历史流水不应被静默编辑。
* 重复报名结算不能创建重复奖励。
* 重复兑换退款补偿不能创建重复退款。
* 活动完成、报名奖励和完成通知必须原子提交。

## 商店

* 商品属于球队。
* 兑换价格保留历史值。
* 金币扣减、库存扣减和兑换创建必须是事务性的。
* 重复请求不能产生重复购买。
* 取消和退款补偿必须是事务性的，并且具备幂等性。

## 通知

* 通知类型严格为 `new_event`、`coin_earned`、`redemption_completed` 和 `team_announcement`。
* 活动发布入库时产生唯一一批活动通知。
* 活动更新同步已有 `new_event` 内容；物理删除活动会移除相关活动通知。
* 站内收件箱持久化是权威来源；推送投递失败不能回滚核心事务。

## 安全

前端永远不是以下信息的权威来源：

```text
roles
permissions
membership state transitions
signup eligibility
event state transitions
coin reward amounts
coin balances
inventory
redemption eligibility
```

以上内容都必须由 FastAPI 校验。

---

# 22. 实体列表

数据库包含：

```text
01. User
02. Organization
03. Team
04. TeamMembership

05. Event
06. EventSignup
07. MatchDetails
08. MatchLogEntry
09. CoinRule
10. CoinTransaction

11. StoreItem
12. Redemption

13. Notification
14. DeviceToken
```

此模型应作为当前数据库设计。

Codex 不应在没有具体产品需求或明确架构决策的情况下引入额外实体、主要抽象或基础设施。
