# 世界书触发词字段核查

核查日期：2026-09-20。本文核对本地 SillyTavern 源码、当前后端和原型编辑器中的触发词字段。

## 结论

`keys` 与 `key` 的差异来自 SillyTavern 的角色卡内嵌格式与世界书内部格式。当前后端已经接收两种字段，并统一为 `key` 后执行触发匹配。原型编辑器此前漏读 `keys`，属于编辑器字段映射遗漏。此前“保存前才发现内嵌和外置格式差异”的说明遗漏了已有解析能力，不能用来判断后端缺少支持。

## 来源与处理链

| 环节 | 实际行为 | 源码依据 |
| --- | --- | --- |
| SillyTavern 写入角色卡 | 将世界书条目的 `key` 写为 `keys`，`keysecondary` 写为 `secondary_keys` | 本地 SillyTavern `src/endpoints/characters.js:672` |
| SillyTavern 读取内嵌书 | `convertCharacterBook` 将 `keys` 转回 `key` | 本地 SillyTavern `public/scripts/world-info.js:5498` |
| 本项目解析世界书 | `parseWorldBook` 接受数组和对象形式的 entries；`normalizeEntry` 将两组字段统一为 `key`、`keysecondary` | `packages/adapters-sillytavern/src/parsers/worldbook-parser.ts:12,202,248` |
| 加载独立世界书版本 | 调用同一个 `parseWorldBook` | `apps/api/src/services/prompt-resource-loader.ts:445` |
| 加载角色快照内嵌书 | `parseCharacterBookWorldbook` 调用同一个 `parseWorldBook`；该入口要求 entries 为数组 | `apps/api/src/services/prompt-assembler.ts:2797` |
| 触发匹配 | `collectPromptWorldbooks` 汇集两种来源，`triggerPromptWorldbooks` 逐书调用同一个 `triggerWorldBook` | `apps/api/src/services/prompt-assembler.ts:2821,2891` |

本地参考仓库根目录为 `/srv/data/mac bookpro old/AI/SillyTavern`；其余源码路径相对于本工作树。

加载入口、资源归属和版本绑定有所区别，关键词解析与触发引擎共用。上述结论限定于触发词字段及这条调用链。

## 当前原型为什么保留 keys

正式 `POST /import/character` 在解析成功且内嵌书有条目时，将它抽取为独立世界书，并从角色快照移除 `characterBook`。该行为位于 `apps/api/src/routes/imports.ts:1379`，在工作树 HEAD 中已经存在；触发词别名解析在 HEAD 中也已经存在。

旧原型加载脚本第一次导入只传角色基础字段，没有传 `character_book`；随后通过角色版本接口写入完整 snapshot，才把 `characterBook` 写入角色。因此当时没有执行正式导入中的内嵌书抽取。

现已修正 `apps/web/prototypes/checks/serve-published-prototype.mjs`：使用现有 `snapshotToStCharacterCard` 序列化完整导入内容，直接采用导入返回的角色版本和独立世界书版本。已有两个角色的修复与验证见 [独立世界书绑定修复](bound-worldbook-migration.md)。

原型编辑器现在通过 `worldbookEntryKeywordLists` 读取两组字段，并在 `synchronizeWorldbookEntry` 中同步写入别名。代码位于 `apps/web/prototypes/shared/formal-admin-workspace.prototype.js:470,647`。同时写两组字段是当前编辑器的保存方式，不是后端要求每个条目必须具有两组字段。

## 验证结果与边界

1. 运行已有 `packages/adapters-sillytavern/src/__tests__/worldbook-parser.test.ts`，16 项通过，其中已有对象 entries/key 和数组 entries/keys 的用例。
2. 直接调用源码解析器，对同一条目的两种表示执行深度相等断言，通过。
3. 将两种解析结果分别送入同一触发引擎，比较关键词命中、不命中、空消息上下文的输出，全部相等。
4. 核对并验证别名优先级：非空 `key` 优先；`key` 为空时读取 `keys`。两者冲突时可能读取旧值，因此保存端必须保持字段一致。

本次验证没有修改角色数据、发布配置或后端解析行为，也没有进行新的模型演绎请求。此次结果证明字段转换与触发链一致；世界书其他字段的完整行为属于单独验收范围。
