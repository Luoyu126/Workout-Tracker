# Workout Tracker Codex 开发约束

## 1. 适用范围与执行级别

本文件位于仓库根目录，适用于整个仓库。Codex 在分析、修改、生成或审查本项目代码时，必须先阅读并遵守本文件；子目录如有更具体的 `AGENTS.md`，只能补充局部规则，不得削弱这里的架构边界。

本项目采用“前后端分离的模块化单体”。现有分层是必须保护的架构，不得为了少写文件、快速修复或所谓简化而绕过。除非用户明确要求并批准架构变更，否则不得移动职责、合并层级、引入替代架构或进行跨模块大重构。

若用户需求与本文冲突，必须先指出具体冲突、影响范围和建议方案，取得明确决定后再改变架构；不得静默破坏约束。

## 2. 开工前必须建立的上下文

修改代码前，必须按本次任务的相关性阅读以下基线，不得仅凭提示词猜测业务：

1. `requirements.md`：产品范围、角色和业务规则。
2. `database.md`：数据实体、字段、关系和枚举的唯一权威基线。
3. `api-spec.md`：HTTP endpoint、请求、响应、错误和权限契约。
4. `tech_stack.md`：技术选型、运行时架构、事务与测试约束。
5. `workout_tracker_project_review.md`：业务 → 数据模型 → 后端分层 → API 契约 → 前端页面与状态的审查方法。
6. 待修改模块的现有实现和相邻测试。

文档有冲突时，不得自行混用两套设计。数据实体以 `database.md` 为准，业务行为以 `requirements.md` 为准，外部 HTTP 形状以 `api-spec.md` 为准，技术分层以 `tech_stack.md` 和本文为准；仍无法消解时，先向用户报告冲突。

每次改动都应从一个明确的业务用例出发，并能回答：谁执行、对哪个球队/资源执行、需要什么权限、状态如何变化、数据如何持久化、API 契约是否变化、前端哪些页面受影响。

## 3. 总体依赖方向

后端请求处理必须保持以下单向依赖：

```text
Router → Application Service → Domain Helper → Repository / Query → Model
   │              │                                      │
   └── Schema     └── AppError                            └── PostgreSQL
```

允许 Service 直接调用 Repository / Query；Domain Helper 是复杂、可复用领域规则的可选层，不要求为简单逻辑机械新增文件。禁止反向依赖和跨层捷径：

- Model、Repository、Query 不得导入 Router。
- Repository、Query 不得导入 Service，也不得调用 HTTP/FastAPI 层。
- Service 不得调用 Router 函数。
- 一个业务模块不得导入另一个模块的 Router。
- Mobile 不得直连应用数据库，也不得复制后端的权威业务决策。

新增功能优先放入现有业务能力模块：`users`、`organizations`、`teams`、`events`、`coins`、`store`、`notifications`。只有出现边界清晰且无法合理归属的新业务能力时，才能提议新模块；未经用户明确同意，不得新建替代现有概念的模块或“第二套”实现。

## 4. 后端目录与分层职责

后端位于 `backend/app/`，按业务模块组织。新代码必须沿用模块内的标准文件职责。

### 4.1 Router 层：`router.py` / `*_router.py`

Router 只负责把 HTTP 请求翻译成一次应用层调用：

- 声明 method、path、status code、请求/响应 schema。
- 解析 path/query/body。
- 通过 `Depends` 获取当前用户、数据库 Session 等请求依赖。
- 调用 Service 并返回结果。

Router 中禁止：

- 直接执行 SQLAlchemy 查询或 `session.add/flush/commit/rollback`。
- 实现成员权限、状态流转、金币、库存、结算、幂等或其他业务规则。
- 编排多个写操作来完成一个业务用例。
- 捕获业务异常后临时拼装另一种错误 JSON。
- 为绕开 Service 而直接调用 Repository。

健康检查和纯 HTTP 适配逻辑除外，但不得借例外承载业务。

### 4.2 Schema 层：`schemas.py` / `*_schemas.py`

Schema 负责 API 边界的数据形状：

- 定义 Pydantic request/response model、字段类型、长度、格式和基础的单对象交叉字段校验。
- API JSON 字段保持 `snake_case`，ID 使用 UUID，时间使用带时区的 ISO 8601 UTC 语义。
- Request 与 Response 分离，不得直接把任意 ORM 对象或内部字段暴露给客户端。
- 密码、token、密钥、内部日志上下文等敏感信息永不进入响应 schema。

Schema 可以做“字符串去空白”“结束时间晚于开始时间”这类输入有效性校验；涉及数据库现状、当前用户权限、资源所属球队、状态流转、余额或库存的规则必须留在 Service。

不得为同一数据库概念发明别名字段、替代枚举或临时响应形状。契约变化必须同步 `api-spec.md`、相关测试、OpenAPI 产物和移动端调用方。

### 4.3 Application Service 层：`service.py` / `*_service.py`

Service 是业务用例和业务规则的唯一主要入口，负责：

- 权限校验和资源归属校验，不能只信任客户端传入的 `team_id`。
- 业务状态流转、不变量、幂等和冲突判断。
- 编排本模块 Repository / Query、必要的领域 helper 和明确的跨模块能力。
- 控制一个写用例的原子性及成功后的返回。
- 抛出稳定的 `AppError` 子类，不向 Router 泄漏数据库异常作为公共契约。

每个写用例只能有一个清晰的 commit/rollback 边界。沿用 `transaction_boundary(session)`：Application Service 拥有 commit/rollback；下层可以 `flush` 获取数据库结果，但不得 `commit`。不得在一次业务用例中分段提交，除非既有设计明确把外部非事务副作用放在核心事务成功之后。

跨模块调用必须表达真实业务协作，并保持依赖方向清晰。若形成循环依赖，应抽取狭窄的共享领域能力或重新划分用例，不得用延迟导入、复制代码或从 Router 绕行来掩盖循环。

### 4.4 Domain Helper 层

如 `teams/eligibility.py`，用于复杂且可复用的纯领域判断或领域操作：

- 不感知 HTTP、FastAPI Request/Response 或页面状态。
- 不拥有 commit/rollback；需要持久化时最多 flush。
- 不为了“形式上分层”创建只有一行转发的抽象。

通用技术能力放在 `backend/app/common/`，但 `common` 不是杂物箱。只有真正被多个业务模块共享且不属于任何单一领域的认证、数据库、权限基元、事务、日志、分页、请求上下文、基础错误和验证工具才能进入其中。

### 4.5 Repository / Query 数据层

`repository.py` / `*_repository.py` 负责实体级数据库访问：

- SQLAlchemy 查询、增删改、锁、flush、refresh 和持久化细节。
- 写操作需要并发保护时提供显式的 `FOR UPDATE` 等锁定方法。
- 不做 HTTP 映射，不决定当前用户是否“应该”被授权，不承载完整业务流程。
- 不 `commit`、不 `rollback`，事务属于 Service。

`queries.py` 用于命名明确、固定查询次数的跨表聚合读取，例如球队主页或报名榜。Query 可以返回专用 read model/dict，但不得偷偷修改数据或引入业务状态流转。

禁止在 Router、Schema、前端或任意临时 utility 中散落 SQL。重复查询应收敛到对应 Repository / Query，并避免 N+1 查询。

### 4.6 Model 与 Migration 层

- ORM 模型集中遵循 `backend/app/models.py` 和 `database.md` 的权威定义。
- 不得新增 Attendance、User.balance 或其他与现有权威来源竞争的实体/字段。
- 数据库结构变化必须通过 Alembic migration 实现；不得只改 ORM 模型，也不得修改已发布 migration 来伪造历史。
- 唯一性、外键、check constraint、索引和并发语义应在数据库层与 Service 层共同保护，不能只靠客户端校验。
- 新增核心实体、改变关系或枚举前，必须先获得用户明确批准并同步 `database.md`、`requirements.md`、`api-spec.md`、模型、迁移和测试。

### 4.7 Error 与入口层

- 预期业务失败使用模块 `errors.py` 中稳定的 `AppError` 子类和错误 code。
- HTTP 映射、结构化日志和 `X-Request-ID` 由全局 exception handlers 统一处理。
- 不得在各 Router 中创建不一致的错误 envelope；不得把 SQL、堆栈、token 或敏感上下文返回给客户端。
- `backend/app/main.py` 只做应用装配：设置、中间件、全局 handler 和 Router 注册，不放业务逻辑或数据库查询。

## 5. 不可破坏的领域不变量

任何功能、重构和修复都必须保护以下规则；客户端显示或校验不能替代后端强制执行：

- `User` 与 `Team` 通过唯一的 `TeamMembership` 建立多对多关系；球队角色只来自该关系。
- 业务角色只有 `member` 和 `admin`。`admin` 用于管理，不能报名、不能进入报名统计、不能获得活动报名奖励；真实参赛队长使用 `member` 逻辑。
- 只有 `active` membership 代表已加入球队；`pending` 仅为申请，不能访问球队私有能力。重复申请与审批遵守既有幂等规则。
- 活动统一使用 `Event`；比赛专属信息使用 `MatchDetails` 和 `MatchLogEntry`，不得建立平行的 Training/Match 主实体。
- `EventSignup` 是参与意愿以及完成奖励的来源；MVP 不新增独立 Attendance/late/考勤域。
- `not_going` 必须提供原因；活动完成后报名和比赛记录只读。
- 报名奖励只给符合资格且 signup 为 `going` 的 member，同一活动、同一用户最多发放一次。
- 金币属于 `(user, team)`，权威余额是不可变 `CoinTransaction` 流水之和。不得创建或更新 `User.balance` 一类可变权威余额，不得覆写历史流水。
- 奖励金额由后端按球队有效 `CoinRule` 决定，客户端不得提交或决定奖励金额。
- 兑换时的余额检查、库存检查、订单创建、扣币和扣库存必须在同一数据库事务中完成；取消/退款使用补偿流水，不篡改原扣币流水。
- Inbox 的权威来源是 `Notification`；远程 push 失败不得回滚已经成功的核心业务事务。
- 所有客户端可重试写操作必须保持现有 client UUID、payload 一致性校验、唯一约束和幂等语义，不得以“先查后写”替代必要的事务/锁/约束。

更完整的字段、状态和边界以基线文档为准。不得依据旧注释、临时 UI 字段或猜测改变这些规则。

## 6. API 契约纪律

- Endpoint、method、权限、request、response 和错误 code 是前后端契约；不得只改一端。
- FastAPI 是权限、状态流转、结算、余额和库存的权威执行方。
- 新增或修改 API 时，先检查 `api-spec.md` 和相邻 endpoint 的命名风格，保持资源关系和 `/api/v1` 前缀一致。
- 返回稳定的 response schema，不让前端依赖 ORM 内部、懒加载关系或临时字段。
- 契约变化完成后运行 `npm run api-client:generate` 更新 `packages/api-client/openapi.json` 与生成代码，并运行 `npm run api-client:check`。生成文件不得手改。
- 如果需求不要求改变公共契约，应优先做向后兼容的内部修复，不随手重命名字段、状态或错误 code。

## 7. Mobile 前端分层

移动端位于 `apps/mobile/`，必须保持以下职责：

- `app/`：Expo Router 路由、screen 组合、导航和页面级交互；不直接写 `fetch`，不直连数据库，不实现后端权威业务规则。
- `src/features/<domain>/api.ts`：对应业务域的后端 API 调用、request/response 类型和参数序列化。
- `src/features/<domain>/validation.ts`：用于即时 UX 的客户端输入校验；后端仍必须重复执行权威校验。
- `src/providers/`：跨页面会话、认证和所选球队等真正的全局上下文；不得把所有服务端数据塞入 Context。
- `src/lib/api/`：统一 HTTP client、认证头和错误格式；业务 feature 不各自创建第二套 client。
- `src/components/ui/`：无业务依赖、可复用的基础 UI；业务组件放在对应 feature 或页面附近。
- `src/theme/` 和 i18n 资源：统一设计 token 和用户可见文案；新增用户文案应进入翻译资源，不在页面散落硬编码双语字符串。

服务端状态应通过现有统一的数据访问方式管理。页面可以控制 loading/error/empty/form 等展示状态，但不得自行计算权威余额、奖励资格、权限结论、库存结论或状态流转。前端的角色显示只能用于 UX，后端必须再次授权。

前端类型与 API 不一致时，以确认后的 API 契约修复调用方和生成客户端，不得用 `any`、随意 optional 字段、类型断言或吞掉错误来掩盖漂移。

## 8. 变更工作流

实现任务时必须：

1. 先定位业务用例、权威文档、现有模块和相邻测试。
2. 写出最小影响面，沿现有层级修改；不夹带无关重构、格式化全仓库或依赖升级。
3. 后端写功能时依次考虑 Schema、Service、Repository/Query、Model/Migration、Error、Router，但只改实际需要的层。
4. 对权限、归属、状态、事务、幂等、并发和错误契约逐项检查。
5. API 有变化时同步文档、生成客户端和移动端；数据库有变化时同步 migration 与基线文档。
6. 新增或修改业务行为必须新增/更新测试；修 bug 时优先增加能复现回归的测试。
7. 完成后检查 diff，确认没有跨层捷径、秘密、生成缓存或无关文件。

禁止用以下方式“快速完成”：

- 把业务逻辑堆进 Router 或 React screen。
- 在 Service 里到处复制原始 SQL，或让 Repository 决定完整业务流程。
- 用 broad `except Exception` 吞错并假装成功。
- 用 `any`、`# type: ignore`、关闭 lint/typecheck 或删除测试绕过问题。
- 手工编辑生成的 OpenAPI 客户端、构建产物、缓存或 `node_modules`。
- 未经要求修改 `.env.local`、`.env.remote` 或提交任何真实密钥。
- 为假设中的未来需求引入新实体、通用框架或过度抽象。

## 9. 验证要求

验证应与改动风险相称，并优先运行最窄相关测试，再运行所属端的完整检查。

后端常用检查：

```bash
npm run backend:lint
npm run backend:typecheck
npm run backend:test
npm run backend:migration:sql
```

Mobile / API 契约常用检查：

```bash
npm run api-client:check
npm run mobile:lint
npm run mobile:typecheck
npm run mobile:test
```

跨端、公共契约、数据库、依赖或发布相关改动完成后运行：

```bash
npm run verify
```

不得声称未运行的检查已经通过。若环境原因无法运行，必须在交付说明中列出未验证项、原因和风险。

## 10. 完成标准

代码只有同时满足以下条件才算完成：

- 行为符合产品与数据基线。
- Router、Service、Domain Helper、Repository/Query、Model/Schema 的职责没有混淆。
- 权限、事务、并发、幂等和错误格式得到保护。
- API 与 Mobile 没有契约漂移。
- 相关自动化测试和静态检查通过，或明确报告无法验证的部分。
- 文档、migration 和生成客户端在需要时已同步。
- 改动最小、可读，不包含秘密、缓存、构建产物或无关重构。
