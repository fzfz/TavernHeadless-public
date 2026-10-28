<!-- markdownlint-disable MD013 -->

# 林茜与顾声慢的角色包改造

## 必须要实现的目标

将本地 SillyTavern 的两张原卡转换为当前 JavaScript Runtime 角色包，保留原始配置，在隔离后端中保存真实角色版本，并验证原卡布局、资源、变量与发送交互。

## 来源与文件

原文件位于 `/srv/data/mac bookpro old/AI/SillyTavern/data/default-user/characters/`，分别为 `林茜_妻心如刀_v1.3.32.png` 和 `顾声慢.png`。原文件保持不变。

每张改造卡位于 `apps/web/prototypes/characters/linqian/` 或 `gushengman/`。`source-card.json` 保存 PNG 中提取的完整卡数据；`snapshot.json` 将角色字段映射为现有后端快照字段，保留角色描述、世界书、原正则与插件配置。服务读取[角色注册表](../../apps/web/prototypes/shared/script-characters.json)的 snapshot 文件，经 `POST /characters/:id/versions`（[接口实现](../../apps/api/src/routes/characters.ts)）保存，再附加新版 frontend 包。原插件代码作为来源数据保留；浏览器执行改造后的 `main.js`。

`current` 表示当前分支最新已提交状态，`view` 表示用户当前查看的状态；查看历史时两者可以不同。

| 对象 | 原卡实现 | 改造后的数据及执行来源 |
| --- | --- | --- |
| 林茜状态栏 | `regex_scripts` 中的“状态栏渲染”，读取 MVU 数据 | 保留其 HTML 布局与蓝白样式；`variables.watch` / 布局绑定读取后端的嵌套变量 |
| 林茜数值与时间 | 林茜感情、堕落、内心想法及世界日期、小时、分钟 | 显示值由原字段计算，状态画面绑定 view；后台提交改变 current |
| 林茜选项 | 四个命名选项，经创建用户消息与 `/trigger` 生成 | 读取 current 中的行动选项，使用统一 `chat.send`；原长度、前缀及去重校验继续应用 |
| 顾声慢演绎区 | 原 GAL 脚本解析 `gametext` 内的场景、立绘与对白 | 角色包自己的解析函数与容器；从 `messages.onTextStream` 和 `messages.getFloor` 接收正文 |
| 顾声慢资源 | 原素材词典与原脚本的资源地址规则 | 下载原词典资源后，通过角色版本资源地址交付；别名映射仍在角色包中 |
| 宿主依赖 | 酒馆全局对象、jQuery、插件事件及全局媒体 | 由当前 Runtime 的变量、消息、布局、媒体、事件和计时器接口承接 |

原卡的“显示变量”与“更新变量”分属两个阶段。此次角色脚本订阅已提交变量；原 MVU schema 和世界书更新规则保存在 source-card 与 snapshot 中；林茜另已迁移为 state.schema.json、update-rules.json、derive.js 和 validate.js，并通过[真实模型多次更新验收](../plans/linqian-live-results.md)。系统调用方式见[变量更新 API](state-update-api.md)。正式后端对这些规则的执行仍按[实施计划](../plans/role-app-dual-web-plan.md#实施步骤与纵向可视验收)第三、四步接入。

固定数据模式沿用隔离服务的可控生成流程，林茜的 `scenario.json` 使用原卡文本与变量制作联调数据；顾声慢以 `alternate_greetings[0]` 作为剧情开场，随后使用两段编写的续演数据验证连续发送、场景切换及变量提交。顾声慢的 `first_mes` 作为作品介绍保存，其分类与展示遵循系统开场契约。

开场选择由[系统开场契约](./session-openings.md)定义。角色脚本通过宿主交付的 `data.opening` 渲染本会话已选内容。

## 验收清单

- 原始角色描述、世界书、开场与正则配置可与 source-card 对照，并可从后端角色版本查询读取。
- 两个包通过[统一 package schema](./script-runtime.schema.json#/definitions/package) 校验，清单引用的文本与媒体文件全部存在。
- 林茜状态栏使用原头像，渲染原变量；选项点击保存用户消息；提交后时间与数值更新；历史查看与当前选项保持各自的数据来源。
- 顾声慢在自己的剧情容器中使用原背景和人物立绘，支持对白翻页、流式正文、自有输入与后端消息保存。
- 页面加载、角色脚本执行与媒体资源读取完成检查；异常路径和实际检查结果保存到 `docs/plans/evidence/script-runtime/real-card-checks.json`。

检查入口为 `apps/web/prototypes/checks/real-card-unit.mjs`、`real-card-browser.mjs` 和已有 `script-backend-unit.mjs`。来源保留、变量计算、消息保存及结构校验分别由这些检查覆盖。

## 原卡功能的接口缺口

顾声慢的音乐进度拖动依赖媒体时长、当前位置读取及 seek；当前 Runtime 只有播放、暂停和停止，因此该控件尚未迁移。CG 画廊解锁及显示设置已支持当前页面内操作，跨刷新保存还缺少宿主提供的用户界面偏好存储接口。交付要求与验收归入实施计划的[真实角色卡发现的补充交付项](../plans/role-app-dual-web-plan.md#真实角色卡发现的补充交付项)。

## 非本次目标

隔离原型已完成真实 LLM 和林茜 MVU 更新联调；正式任务调度、持久化事务、原提示词正则链路以及完整角色剧情效果仍须在正式后端验收。来源保留、确定性公式测试和实际剧情语义分别记录。

## 已获得的授权

用户指定使用两张真实卡改造，并明确允许提取、解码 PNG 角色卡配置。用户此前已授权按角色 Runtime 规范重做原型、运行隔离后端、测试并记录缺口。
