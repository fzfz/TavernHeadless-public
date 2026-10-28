---
文档用途: 提供用户 Web 的运行方法、浏览器验收证据和验证范围。
读取时机: 启动用户 Web、复现验收或核对交付结果时读取。
---

# 用户 Web 实现验收

## 1. 运行入口

1. 产品规则采用[需求规格](user-web-requirements.md)，页面与接口对应关系采用
   [功能依据](feature-basis.md)。用户 Web 代码位于 `apps/user-web`。
2. 后端采用 `ACCOUNT_MODE=multi` 和 `AUTH_MODE=api_key` 或 `jwt`。账号接口见[账号 API](../../../vitepress/reference/api/accounts.md)；配置与启动步骤见[原生环境操作手册](../../environment-operations.md)。
3. 浏览器访问环境配置中的用户 Web 入口。角色广场读取管理员已发布的角色；用户登录后创建演绎人格，再选择角色与开场。
4. 发布产物与运行配置由统一环境命令生成，Nginx 为用户 Web 提供页面、公开配置及 API 入口。

## 2. 浏览器验收资料

1. 已有浏览器验收使用可见 Chrome 窗口、独立浏览器上下文和真实 HTTP API。
   桌面视口宽度为 1440 像素，手机视口宽度为 390 像素；页面溢出检查另覆盖 320、844 像素。
2. 隔离 API、确定性供应商和资料准备逻辑见
   [验收服务](../../../apps/user-web/e2e/server.ts)。三环境复验按
   [原生环境操作手册第 8 节](../../environment-operations.md#8-验证与持续集成)准备证据。
3. 页面脚本位于 `apps/user-web/e2e/`。各脚本入口定义浏览器地址、资料目录、管理员凭据和证据目录参数；已验证的页面范围与结果文件见第 3 节。
4. `chat-widget-boundaries.cjs`、`chat-widget-refresh.cjs` 和
   `chat-widget-final-boundaries.cjs` 使用受控传输验证聊天组件的历史读取、阅读位置、焦点、编辑恢复及局部重试。
5. 浏览器网络失败样本由请求拦截产生。保存结果通过 API 响应与页面内容共同确认。

## 3. 页面验收

1. 页面编号见[页面规格索引第 2 节](phase4-page-specs/README.md#2-页面规格索引)。P01—P04：已验证搜索、标签、分页、详情、开场、返回位置、失败重试与空集合。证据：[双端流程](implementation-evidence/discover-acceptance.json)、[边界恢复](implementation-evidence/discover-edge-acceptance.json)。
2. P05—P06：已验证表单校验、密码显示、注册、登录、返回与身份隔离。证据：[门户流程](implementation-evidence/portal-acceptance.json)、[注册恢复](implementation-evidence/auth-recovery.json)。
3. P07—P08：已验证本人资料、人格与历史演绎数量，以及昵称保存和退出登录的响应核对。证据：门户流程、[门户恢复](implementation-evidence/portal-recovery.json)、[退出竞态](implementation-evidence/identity-race.json)、[资料刷新](implementation-evidence/account-refresh.json)。
4. P09—P12：已验证创建多个人格、设置默认人格、保存完整描述、处理编辑冲突、恢复草稿、分页和删除结果核对。证据：门户流程、门户恢复。
5. P13—P14：已验证角色与开场、默认人格、空人格引导、创建结果恢复。证据：门户流程、[会话恢复](implementation-evidence/session-recovery.json)、[创建前核对](implementation-evidence/start-recovery.json)。
6. P15—P16：已验证搜索历史演绎、继续演绎、重命名会话、加载更多历史、选择会话及核对删除结果。证据：[双端历史](implementation-evidence/history-acceptance.json)、[历史边界](implementation-evidence/history-edge-acceptance.json)。
7. P17—P18：已验证独立演绎页、[角色内容区域](phase4-page-specs/page-P17.md)、消息与生成操作。证据：[演绎流程](implementation-evidence/chat-acceptance.json)、[组件边界](implementation-evidence/chat-boundaries.json)、[刷新恢复](implementation-evidence/chat-refresh.json)、[编辑与局部重试](implementation-evidence/chat-final-boundaries.json)、[演绎组装](implementation-evidence/chat-dry-run.json)。
8. P19—P20：已验证标题草稿、设置往返、完整固定人设与保存。证据：门户流程、会话恢复。
9. P21—P22：已验证删除确认与取消、删除默认人格后选择剩余人格、删除最后人格后清空默认选择、保留会话人设快照，以及页面无法访问时的恢复入口。证据：门户流程、门户恢复、历史边界。

## 4. 生成与设备验证范围

1. 确定性供应商用于验证 HTTP、SSE、停止、候选、持久化和页面显示，其输出按测试协议构造。实际模型的人称、剧情与状态更新结果见[真实模型验收](real-model-acceptance.md)。
2. [组装结果](implementation-evidence/api-preflight.json)记录
   `respond/dry-run` 的实际消息、组装字段和 `runtime_trace` 追踪，供核对固定人格、当前输入及角色发布配置；
   阅读结果时按根目录 AGENTS.md 的演绎验收规则判断。
3. 手机验收覆盖真实浏览器的窄视口、输入组合、返回和弹层。iOS、Android 实机软键盘及操作系统后台恢复需要在对应设备验证。

## 5. 工程验证

1. [工程验证结果](implementation-evidence/engineering-checks.json)
   记录全库测试、类型检查、静态检查、SDK 生成检查及构建命令的执行结果。
2. [重启验收](implementation-evidence/startup-binding-recovery.json)记录公开角色绑定的数据库恢复结果。
