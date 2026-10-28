---
文档用途: 保存页面宏实施中确认的责任边界、缺陷原因及证据位置。
读取时机: 作出实施决策、处理失败或恢复压缩后的上下文时。
---

# 页面宏实施发现

## 1. 工作区与实施边界

1. 原计划位于目标工作区的 `.planning/native-card-maintenance/root-cause-research-2026-10-08/session-name-plan.md`；本次修改该工作区 `.agents/skills/native-card-conversion/` 中的仓库 Skill。
2. 页面入口向公共函数提供数据及操作闭包。初值字符串继续由 `DisplaySnapshotService.initialize()` 展开，宿主改动的范围以原计划第 8 节为准。
3. 宏范围、依赖及逐项验收见 `acceptance.md` 第 1、2 节。

## 2. 输入与依赖核对

1. 抽样缓存以 key、value 保存资料；已按 key 核对原始 PNG 路径，结果见 `card-selection.json`。摘要工具首次读取封装对象，随后修正为对应的角色资料对象。
2. Context7 返回 API key 无效，依赖 API 改从官方文档读取。
3. 原始 PNG 的格式结果与缓存 JSON 一致。缺失字段及独立登记的测试输入见 `png-source-admission.json`、`positive-inputs.json`；整卡结果见 `acceptance.md` 第 3 节。
4. pnpm 安装曾重排已有 peer 解析记录。已按起点提交缩减为三个获批依赖的 importer、package、snapshot 增补；安装快照保存在 `pnpm-lock-after-install.yaml`。
5. 第一份依赖基线快照已包含安装结果，首次缩减仍含重排；校正基线后通过离线冻结核对。具体错误及安装过程见 `lockfile-validation.log`、`dependency-install.log`。

## 3. 公共函数与生成入口缺陷

1. 静态依赖曾使未选中的 if 分支触发消息预取；共享求值模块现由实际选中分支触发消息读取，回归结果见 `final-macro-repair-progress.json`。
2. 生成入口的默认布局名可能与原入口重名；绑定生成器现核对原入口已登记的字面量调用，再分配布局标识。
3. 最终独立审查确认成对与空注释被拒绝、角色版本被再次解析，以及语法前缀、分隔符和推进长度重复定义。三项修复及失败用例见 `final-macro-repair-progress.json`；复核结果见 `final-spec-followup.json`、`final-standards-followup.json`。

## 4. 并发绑定的产物责任

1. 两个调用缓存同一个父包后覆盖公共文件，会丢失一条绑定；失败调用恢复父包时，还会删除另一成功调用的文件。四组真实 CLI 对照见 `binding-concurrency-design.json`。
2. 每次绑定现生成独立后续任务，复制输入源快照和完整包。调用方沿成功结果中的 taskFile 继续绑定及打包，父任务文件保持原值。
3. `task-context.ts` 要求后续任务是临时目录的直接子目录，且源快照属于该任务。实现遵循现有目录约束，回归结果见 `concurrency-repair-progress.json`。

## 5. 浏览器验收的读取位置与装载时序

1. 聊天组件位于内层 Shadow DOM；第一次随机卡验收读取外层文本，随后按实际组件所在节点修正。结果见 `random-card-acceptance.json`。
2. lastMessage 与 lastCharMessage 分别异步查询。先前验收在一个绑定完成后立即读取另一个绑定，当前脚本分别等待两者文字完成。
3. 当前 C011 同时包含陆泽状态页签和人物介绍标题；按文字匹配会点中状态按钮，当前脚本使用人物介绍选择器。
4. C011 的折叠样式晚于宏文字完成装载。点击标题时样式尚未生效，随后样式加载隐藏正文；可见性样本见 `C011-visibility-samples.json`。当前脚本先等待折叠样式生效，再点击标题，四个会话通过，结果见 `C011-acceptance.json`。

## 6. 尚未定位的测试与回放问题

1. 第一轮完整测试的四个失败均为 5 秒超时，相同文件定向复跑全部通过。首轮同时执行了浏览器与独立转换任务，当前尚未确认具体资源瓶颈；报告见 `final-full-tests.log`、`final-timeout-recheck.log`。
2. 补充 respond/stream 回放已保存正文，状态任务仍处于 pendingStateFloorId，两个回放步骤只消耗正文步骤。当前尚未确认状态任务未执行的原因，证据见 `preview-stream-acceptance.json`。
