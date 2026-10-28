---
文档用途: 对照用户需求与实现入口，限定用户 Web 的功能范围。
读取时机: 增加页面元素、修改规格、接入接口或验收用户 Web 时读取。
---

# 用户 Web 功能依据

## 1. 范围依据

1. 产品行为采用[需求规格](user-web-requirements.md)，页面交互采用[阶段 4 页面规格](phase4-page-specs/README.md)。
2. 双端设计原型的模拟数据与评审结果见[原型验收](phase7-review-master.md)；用户 Web 的启动方法与验收证据见[实现验收](implementation-acceptance.md)。

## 2. 功能与数据来源

| 功能                                   | 需求依据            | 前端入口                                                                                                                                                            | 后端或运行模块                                                                                                                                                   |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 注册、邮箱密码登录、退出               | 账号访问            | [AuthPage](../../../apps/user-web/src/features/portal/AuthPage.vue)                                                                                                 | [身份路由](../../../apps/api/src/routes/user-identity.ts)、[身份服务](../../../apps/api/src/services/user-identity-service.ts)                                   |
| 本人资料、昵称、人格数与历史数         | 用户中心            | [AccountPage](../../../apps/user-web/src/features/portal/AccountPage.vue)                                                                                           | 身份路由、[人格路由](../../../apps/api/src/routes/users.ts)、[会话路由](../../../apps/api/src/routes/sessions.ts)返回的总数                                      |
| 角色列表、详情、作者、故事、标签与筛选 | 角色卡选择          | [DiscoverPage](../../../apps/user-web/src/features/portal/DiscoverPage.vue)                                                                                         | [公开角色路由](../../../apps/api/src/routes/public-roles.ts)、[固定发布版本](../../../apps/api/src/services/role-release-service.ts)                             |
| 多个人格、姓名、完整描述与默认选择     | 个人演绎人格        | [PersonasPage](../../../apps/user-web/src/features/portal/PersonasPage.vue)、[PersonaForm](../../../apps/user-web/src/features/portal/PersonaForm.vue)              | 人格路由、身份服务保存的账号偏好                                                                                                                                 |
| 选择人格与开场、开始演绎               | 创建演绎会话        | [StartPage](../../../apps/user-web/src/features/portal/StartPage.vue)                                                                                               | [公开角色会话服务](../../../apps/api/src/services/public-role-session-service.ts)、[可信发布绑定](../../../apps/api/src/services/public-role-session-binding.ts) |
| 历史列表、搜索、继续、重命名与删除     | 历史管理            | [HistoryPage](../../../apps/user-web/src/features/portal/HistoryPage.vue)                                                                                           | 会话路由及其批量操作结果                                                                                                                                         |
| 独立演绎页、返回历史、标题与固定人格   | 会话访问            | [SessionPage](../../../apps/user-web/src/features/portal/SessionPage.vue)、[SessionSettingsDialog](../../../apps/user-web/src/components/SessionSettingsDialog.vue) | 会话详情及创建时的人格快照                                                                                                                                       |
| 消息、发送、停止、续写与结果恢复       | 核心演绎流程        | [ChatSession](../../../apps/user-web/src/features/chat/ChatSession.vue)、[聊天控件](../../../apps/user-web/src/features/chat/chat-widget.ts)                        | [聊天路由](../../../apps/api/src/routes/chat/index.ts)、[请求凭据](../../../apps/api/src/services/chat/respond-operation-service.ts)                             |
| 重新生成与候选切换                     | 核心演绎流程        | ChatSession                                                                                                                                                         | [候选服务](../../../apps/api/src/services/reply-candidate-service.ts)及聊天路由                                                                                  |
| 消息编辑与单条删除                     | 核心演绎流程        | 聊天控件                                                                                                                                                            | [消息路由](../../../apps/api/src/routes/messages.ts)、[已保存内容修订](../../../apps/api/src/services/committed-content-manual-revision-service.ts)              |
| 从消息建立分支                         | 核心演绎流程        | ChatSession                                                                                                                                                         | [楼层路由](../../../apps/api/src/routes/floors.ts)、[分支历史](../../../apps/api/src/services/role-runtime/role-branch-history.ts)                               |
| 场景布局、状态与剧情操作               | 角色卡 Runtime 渲染 | [Runtime](../../../apps/user-web/src/runtime/script-runtime.ts)                                                                                                     | 角色固定版本的模板、样式、脚本与公开显示数据                                                                                                                     |
| 草稿、主题、分页位置、空态与失败反馈   | 上述任务的交互细化  | [门户入口](../../../apps/user-web/src/features/portal/PortalApp.vue)及对应页面                                                                                      | 账号隔离的本标签页草稿、浏览器主题偏好与实际请求结果                                                                                                             |

## 3. 元素准入规则

1. 增加业务入口、统计或配置项时，设计者须在第 2 节登记对应需求、数据来源和消费入口。
2. 角色内容区的布局与剧情操作由角色固定版本提供；产品功能采用需求规格第 4 节规定的宿主职责。
3. 浏览器验收分别记录真实身份、资源归属、持久化、请求结果、刷新恢复和页面显示。生成验收注明供应商与样本范围。
