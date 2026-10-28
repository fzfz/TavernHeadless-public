# 原生角色卡编辑与 ZIP 接口

状态：2026-09-28 契约已确定，正式实现与联调进行中。共享 HTTP 结构位于 `packages/shared/src/schemas/native-card-api.ts`；包文件结构和规则位于 `packages/shared/src/schemas/native-card-package/` 与 `packages/shared/src/config/native-card-file-rules.json`。联调计划定义 I01–I15 验收项目；各项实际结果和证据记录于 `.planning/native-card-production/evidence/acceptance.json`。

## 必须要实现的目标

后端为管理端提供原生 ZIP 检查与确认导入、持久文件编辑、固定修订发布、预览会话和打包下载。SDK 通过 `client.nativeCards` 封装这些接口。角色作者的内容进入角色包；运行配置由系统资源 ID 绑定。

## 身份、文件与错误

`id` 是本机角色卡 ID，`characterId` 是本机人物资源 ID，`packageId` 是跨导入导出保留的包标识。`revision` 是一次成功保存产生的正整数。`versions[].id` 标识已发布人物版本；发布结果另返回 `releaseId`，供正式会话固定发布配置。

文件列表包含 `path`、`mediaType`、`purpose` 和 `byteSize`。文件读取返回 `path`、`mediaType`、`encoding` 和 `content`；`encoding` 为 `utf8` 时直接编辑文本，为 `base64` 时由客户端还原二进制。文件路径始终相对于包根目录。

JSON 成功响应为 `{data:结果}`。二进制下载返回 `application/zip`。失败采用现有 `{error:{code,message,details}}` 结构。包检查的 `issues` 每项包含 `code`、`path`、`message`、`action`，并按可定位范围提供 `pointer`、`line`、`column`、`operationIndex`、`expected`。前端读取统一错误码文案，问题列表显示具体文件、字段和修正操作。

| 情况 | HTTP 结果 | 客户端动作 |
| --- | --- | --- |
| 无管理权限 | 403 | 使用具有项目配置权限的管理员账号 |
| 角色、修订或任务不存在 | 404 | 刷新目录并重新选择对象 |
| 包格式或文件检查失败 | ZIP 检查返回 `status:"invalid"`；已保存修订校验返回 `valid:false`；保存或确认导入的完整包校验失败返回 422，请求结构错误返回 400 | 保留编辑内容，按 issues 修正后重新提交 |
| ZIP 请求体超限 | 413 | 缩减包大小后重新选择文件 |
| 预期修订过期 | 409，`NATIVE_CARD_REVISION_CONFLICT`，详情含 `expectedRevision` 和 `actualRevision` | 保留本地修改，读取新修订，对照合并后再保存 |
| 文件或数据库操作失败 | 500，`NATIVE_CARD_STORAGE_FAILURE` | 按下述详情区分写入失败和读回失败，保留本地修改并核对提交结果；导入确认使用同一检查任务重试读回 |
| 打包未完成或产物过期 | 409 或 404 | 等待完成，或为原修订重新打包 |

写入失败的 `error.details` 由 `nativeCardWriteFailureDetailsSchema` 定义。`stage` 为 `file-commit` 或 `database-commit`；`revision` 标识本次尝试写入的候选修订。数据库事务回滚时返回 `committed:false`，表示候选修订尚未提交。`cleanupFailed:true` 表示本次目录清理失败，该标记与数据库提交结果分别记录。页面保留本地修改；已确认事务回滚时仍以原 `expectedRevision` 重试，提交结果不明时先读取角色当前修订再决定重试。读取故障使用读取对象详情，不携带写入提交结论。

## 接口和调用顺序

### 包文件到运行消费者的映射

下表描述正式实现的连接位置；行为是否通过验收以联调计划 I01–I15 的证据为准。包结构解析由 `packages/shared/src/native-card-package.ts` 执行，持久保存由 `apps/api/src/services/native-card/native-card-service.ts` 执行，资源关联由 `apps/api/src/services/native-card-runtime/native-card-runtime-service.ts` 执行。

| 验收项与包输入 | 解析结果 | 存储与关联 | 运行消费者 |
| --- | --- | --- | --- |
| I01–I02：ZIP 字节 | ZIP 文件集合、路径及大小检查 | `native_card_import` 和暂存目录 | 管理端导入核对页 |
| I03：根 `manifest.json` | 包身份、格式、文件登记和前端入口 | `native_card`、`native_card_revision` 和修订目录 | 原生包服务；前端入口交给视图服务 |
| I04：`character.json` | 人物资料、世界书和正则顺序 | `characters`、`character_version`；`native_card_version_binding` 固定修订 | 角色发布服务、提示词资源加载器 |
| I05：`openings.json`、`openings/*.txt`、`state/initial/*.json` | 开场正文、适用会话类型和初始状态 | 人物版本的 `extensions.tavern_headless.openings` | 会话初始化和状态服务 |
| I06：`worldbooks/{bookId}/book.json`、`entries/*.json` | 书 ID、有序条目和启停标记 | 世界书资源及版本、`native_card_resource_binding`；人物版本保存有序绑定 | 提示词资源加载器与世界书组装器 |
| I07：`backend/controllers/config.json` 和模块 | 书 ID 与条目 ID 引用、控制器配置 | 固定修订文件、人物版本中的控制器配置 | 提示控制器服务 |
| I08：`agents/state-update/profile.json`、规则文件、`state/schema.json` | 变量更新行为、可写路径和状态定义 | 固定修订文件、人物版本中的状态配置 | 状态更新服务；模型读取系统 `state_updater` 槽 |
| I09：`backend/validators/`、`backend/variable-tools/` | 对应用途的模块和导出契约 | 固定修订文件 | 状态更新服务的校验器与变量工具加载器 |
| I10：`frontend/manifest.json`、HTML/CSS/JS、`assets/`、`data/` | 显示模板和资源映射 | 修订文件；版本绑定解析文件 URL | 角色资源服务、角色视图服务和用户端脚本运行器 |
| I11：`regex/*.json` | 按 `character.json` 声明排序的正则配置 | 正则资源及版本、`native_card_resource_binding` | 提示词与正文正则处理链 |
| I12：系统配置 ID | 预设、人设和模型槽绑定 | `role_release` 的固定配置快照 | 会话初始化、提示词组装及模型调用 |
| I13–I14：文件批量操作 | 候选完整文件集合及预期修订 | 新修订目录及数据库事务；发布关联 `native_card_publication` | 编辑器读回；旧会话继续读取固定人物版本 |
| I15：已保存修订或已发布版本 | 固定修订文件集合 | `native_card_build` 和 ZIP 产物目录 | 打包状态接口、下载接口及独立环境导入器 |

### HTTP 接口

以下路径省略 API 基址。所有接口使用现有账号认证。管理接口验证管理员角色和 `project.config.write` 能力。

| 标题及用途 | 方法与路径 | 输入 | 输出 |
| --- | --- | --- | --- |
| 列出可编辑角色卡 | `GET /native-cards` | 当前账号 | `NativeCard[]` |
| 创建角色卡 | `POST /native-cards` | `{name,sourceVersionId?}` | 已保存的 `NativeCard`；省略来源时包含最小必需文件，指定来源时复制本账号已发布版本的包内容 |
| 打开角色卡 | `GET /native-cards/:cardId` | 角色卡 ID | `NativeCard` |
| 读取文本或媒体 | `GET /native-cards/:cardId/file` | query `path`、可选 `revision` | `NativeCardFileContent`；省略修订时读取当前已保存修订 |
| 分配世界书条目 UID | `POST /native-cards/:cardId/entry-uids/allocate` | `{expectedRevision,bookId,reservedUids,draftBook?}` | `{uid}`，见下文 |
| 原子保存文件操作 | `PUT /native-cards/:cardId/files` | `{expectedRevision,operations}` | 新修订的 `NativeCard` |
| 校验已保存修订 | `GET /native-cards/:cardId/validation` | 可选 query `revision` | `{valid,issues}` |
| 上传并检查 ZIP | `POST /native-cards/imports` | `Content-Type: application/zip`；原始 ZIP 字节；query `fileName` | `{id,fileName,packageId,name,summary,files,issues,status}`，status 为 `ready` 或 `invalid`；包内容无法解析时 summary 为 null，字段定义见本章后文 |
| 确认已检查 ZIP | `POST /native-cards/imports/:importId/confirm` | 检查结果 ID | 完整提交后的 `NativeCard` |
| 发布指定修订 | `POST /native-cards/:cardId/publications` | `{revision,configuration,note?}` | `{id,cardId,revision,createdAt,characterId,characterVersionId,releaseId,note?}` |
| 建立隔离预览会话 | `POST /native-cards/:cardId/preview-sessions` | `{revision,configuration,openingId?,userId?,sessionType?}` | `{cardId,revision,sessionId,openingId}` |
| 检查候选变量提案 | `POST /sessions/:id/role-state/inspect-proposal` | `{sourceMessages,proposal}`；会话已固定角色修订 | `{before,candidate,derived,issues,valid}`，字段结构见下文 |
| 创建 ZIP 打包任务 | `POST /native-cards/:cardId/builds` | `{source:{revision}}` 或 `{source:{versionId}}` | `NativeCardBuild` |
| 查询打包任务 | `GET /native-card-builds/:buildId` | 任务 ID | `NativeCardBuild` |
| 重试失败打包 | `POST /native-card-builds/:buildId/retry` | 任务 ID | 同一来源修订的 `NativeCardBuild` |
| 下载完整 ZIP | `GET /native-card-builds/:buildId/download` | 已成功任务 ID | ZIP 字节 |

条目新增、复制和跨书移动前，编辑器调用 `client.nativeCards.allocateEntryUid({cardId,expectedRevision,bookId,reservedUids,draftBook?})`。服务从目标书已保存的条目内容读取 UID，并排除 `reservedUids` 中当前工作区尚未保存的 UID，返回从 1 起最小可用值。新建但尚未保存的世界书传入 `draftBook`，其结构采用共享世界书 schema；服务验证该草稿后按 `reservedUids` 排除已占用值。调用只计算当前修订的候选 UID；保存接口再次验证整包与修订。当前修订已变化时返回 `NATIVE_CARD_REVISION_CONFLICT`，编辑器先处理冲突再请求分配。

文件操作使用以下三种结构：`{op:"write",path,encoding,content}` 新增或替换文件，`{op:"move",path,to}` 移动文件，`{op:"delete",path}` 删除文件。客户端同时提交受影响的结构化清单与引用修改。后端先在候选文件集合应用全部操作，再统一校验并提交。固定入口的路径约束由文件规则配置定义。

编辑器从 `packages/shared/src/config/native-card-file-rules.json` 的 `creationTemplates` 读取新文件内容。该配置文件中的目录规则可用 `creationTemplateId` 指定作者自定义文件名时使用的模板；固定入口仍优先使用其专用模板。例如 `agents/state-update/*.json` 指向 `stateUpdateRules`，新规则文件包含 `rules` 数组；`agents/state-update/profile.json` 使用独立的 Agent 配置模板。

`configuration` 包含 `presetId`、`presetVersionId`、`defaultUserId`、`promptMode`、`modelSlots`。模型槽条目沿用系统角色发布的 `{slot,profile_id,params?}` 结构。该配置用于创建发布和预览会话，ZIP 导出只读取角色修订的包文件。

`note` 保存发布时填写的版本说明。`sourceVersionId` 使用发布返回的 `characterVersionId`，创建独立角色卡并以 `name` 更新其人物名称。预览的 `sessionType` 可选 `individual` 或 `group`，省略时采用 `individual`；未指定开场时使用该会话类型的默认开场。

上传与导入分两步：检查接口保存暂存文件及诊断，用户确认后导入接口重读该文件集合并完整提交。检查无效的任务保留具体问题，确认接口拒绝导入。刷新编辑器只读取已提交数据。

ZIP 检查响应的 `summary` 由后端已解析的包内容生成，结构以 `packages/shared/src/schemas/native-card-api.ts` 的 `nativeCardImportSummarySchema` 为准。`formatVersion` 来自根清单；`worldbookCount`、`openingCount`、`initialStateCount` 和 `regexProfileCount` 分别记录世界书、开场、带初始状态的开场和正则配置数量；`stateUpdate`、`promptController` 和 `frontend` 标明包内实际包含的功能。包内容无法解析时 `summary` 为 `null`。管理端使用这些字段展示人物资料、世界书、开场与初始状态、变量更新 Agent、提示控制器、前端与媒体、正则七类资源。

预览接口建立固定修订的会话。提示词检查随后调用 `POST /sessions/:id/respond/dry-run`，正文发送调用现有 SSE 接口，状态与历史读取现有角色 Runtime API。页面预览、文件打开及保存由对应接口完成；模型请求由用户发送操作触发。既有聊天流回调和事件继续由官方 SDK 的 `sessions.respondStream` 处理；原生角色卡接口使用请求响应与任务查询。

变量检查调用 `client.roleRuntime.inspectProposal({sessionId,input})`，读取该预览会话固定的角色版本、变量 schema、规则及模块。`sourceMessages` 至少一条，每条包含 `{messageId,revision,role,text}`，`revision` 为正整数；`proposal` 包含 `changes: [{op:"set"|"remove",path,value?}]`、`evidenceMessageIds` 和可选 `facts`。接口按正式变量提交的顺序检查证据、可写路径、状态 schema、计算函数和校验器，返回 `before`（当前变量）、`candidate`（应用提案后）、`derived`（计算函数执行后）和 `issues: [{code,message,details?}]`。尚未达到的候选或计算阶段返回 `null`；`valid` 表示完整检查是否通过。检查接口计算并返回提案检查结果，保留现有持久状态；模型请求、变量和生成记录写入由正式提交路径负责。配置、账号范围、模块读取等错误沿用 Runtime 错误；提案拒绝以 HTTP 200 的 `valid:false` 和问题数组返回。管理员及 `project.config.write` 权限为调用前提。

```typescript
const inspection = await client.roleRuntime.inspectProposal({
  sessionId: preview.sessionId,
  input: {
    sourceMessages: [{messageId: "preview-1", revision: 1, role: "assistant", text: "沈知夏和裴修远抵达花园门口。"}],
    proposal: {
      changes: [{op: "set", path: "/location", value: "花园门口"}],
      evidenceMessageIds: ["preview-1"]
    }
  }
});
```

打包任务状态为 `queued`、`running`、`succeeded` 或 `failed`；阶段为 `validating`、`archiving` 或 `ready`。任务包含 `id`、`cardId`、`revision`、可选 `versionId`、创建与更新时间、问题列表，成功时提供下载地址。关闭任务窗口后编辑器可继续操作；下载来源由任务保存的修订决定。服务失败重试同一修订，内容错误修正并保存后创建新任务。

## 提交和中断时序

后端按账号隔离角色卡、检查任务和打包任务。配置 `apps/api/config/native-card.json` 定义存储根目录、上传字节、解压字节、文件数、单文件字节、路径字节与产物保留期限。配置路径解析于系统 `DATA_DIR` 指定的数据根目录。

保存时，服务先将候选集合写入独立暂存目录，完成全部检查后移动为唯一修订目录，再在数据库事务中登记修订和资源映射，并以预期修订作为更新条件。只有事务成功且完整文件可读时才返回成功。写文件期间中断的目录没有已提交索引；事务提交前中断的完整目录也不会成为当前修订。提交失败时服务清理本次目录，保留原已提交修订。

确认导入请求使用检查结果中的 `importId`。服务在创建人物、卡身份、修订和资源映射的同一事务中，将卡 ID 写入 `native_card_import.confirmed_card_id`。调用方未收到确认结果时可对同一任务重试；任务有效期内，服务返回已创建的同一张卡。其他账号、缺失或已过期任务返回 `NATIVE_CARD_IMPORT_NOT_FOUND`；已确认卡被删除时返回 `NATIVE_CARD_NOT_FOUND`。管理端关闭导入窗口、重新打开或更换 ZIP 后，只接收当前导入请求的检查结果。

发布固定选定修订及系统资源版本，后续编辑增加新修订。旧会话继续读取创建时的版本。进程中断的打包任务恢复为明确失败状态，用户可对固定来源重试。

## SDK 调用示例

`client.nativeCards.downloadArtifact({buildId})` 用于下载已完成任务的 ZIP。SDK 通过现有认证传输发起下载，返回 `{blob: Blob, fileName: string | null}`；后端通过 `Content-Disposition` 提供固定产物文件名，并向跨域浏览器开放该响应头。响应头缺少文件名时 `fileName` 为 `null`，无效文件名会使 Promise 拒绝。HTTP 失败沿用 SDK 错误对象。页面等待 Promise 完成后，将字节和文件名交给下载控件；该方法没有回调。仅需要字节的调用方可使用 `downloadBuild({buildId})`。

```ts
const checked = await client.nativeCards.checkImport({
  file: selectedFile,
  fileName: selectedFile.name,
});
if (checked.status === "ready") {
  const card = await client.nativeCards.confirmImport({ importId: checked.id });
  const opening = await client.nativeCards.readFile({
    cardId: card.id, revision: card.revision, path: "openings/first.txt",
  });
  const saved = await client.nativeCards.save({
    cardId: card.id,
    expectedRevision: card.revision,
    operations: [{
      op: "write", path: opening.path, encoding: "utf8",
      content: "向导停在门边，等待裴修远回答。",
    }],
  });
  const task = await client.nativeCards.createBuild({
    cardId: card.id, source: { revision: saved.revision },
  });
  const current = await client.nativeCards.getBuild({ buildId: task.id });
  if (current.status === "succeeded") {
    const artifact = await client.nativeCards.downloadArtifact({ buildId: task.id });
    // 页面将 artifact.blob 和 artifact.fileName 交给浏览器下载控件。
  }
}
```

## 完整角色示例

前端 API、后端 API 和 Agent 工具文档共同使用“雾港来信”原生包。完整文件内容保存在 `apps/api/test/fixtures/native-card/harbor.files.json`：它包含两本世界书、两个开场、独立初始状态、控制器、变量计算与校验模块、有序正则、自定义前端及媒体和数据文件。`backend/variable-tools/derive.js` 由变量更新服务调用；模型工具接入范围仍按 Agent 工具文档的执行入口表确定。

作者在完成项目安装和构建后，从仓库根目录运行以下命令，使用正式 ZIP 写入器生成示例包。JSON 文件是文件内容的结构化映射，打包程序逐项写入这些内容。

```sh
pnpm exec tsx --input-type=module <<'JS'
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { writeNativeCardZip } from './apps/api/src/services/native-card/zip.ts';
const contents = JSON.parse(await readFile('apps/api/test/fixtures/native-card/harbor.files.json', 'utf8'));
const files = Object.entries(contents).map(([path, content]) => ({ path, content: Buffer.from(content, 'utf8') }));
await mkdir('.planning/native-card-production', { recursive: true });
await writeFile('.planning/native-card-production/harbor-example.zip', writeNativeCardZip(files));
JS
```

作者通过正式编辑器的“导入原生 ZIP”选择生成的 `harbor-example.zip`，检查并确认导入。编辑器的系统运行设置负责绑定预设、人设、正文模型与变量更新模型。发布后选择“运行此发布版本”，会话从固定版本读取示例文件。

本机确定性验收使用 `apps/api/scripts/native-card-acceptance.ts` 启动 API 与受控供应商，配置位于 `apps/api/test/fixtures/native-card/acceptance-config.json`。运行 `pnpm --filter @tavern/api exec tsx scripts/native-card-acceptance.ts` 后，API 位于 `http://127.0.0.1:3041`；作者另启管理端 `VITE_API_BASE_URL=http://127.0.0.1:3041 pnpm --filter @tavern/web dev --host 127.0.0.1 --port 5195`，打开 `/native-card-editor`。导入后可指定角色编号运行 `NATIVE_CARD_ACCEPTANCE_CARD_ID=角色编号 pnpm --filter @tavern/api exec tsx scripts/native-card-acceptance-publish.ts`；该程序通过正式 SDK 发布、创建会话并保存 dry-run 结果。验收配置的持久目录中，`runtime-publication.json` 记录发布与会话，`dry-run.json` 记录实际组装消息。此入口使用固定模型响应，外部供应商输出另按授权验收。

## 验收清单

本章定义验收动作；主 Agent 执行以下验收，在 `.planning/native-card-production/evidence/acceptance.json` 记录对应 I01–I15 项的状态和证据路径；每项列出的可观察结果全部成立后标记通过。

- I01、I02、I13：在正式管理端通过 SDK 上传有效 ZIP、确认导入、读取文件并保存修改；刷新后读取同一角色和新修订。损坏 ZIP 返回具体错误；旧修订保存返回 409，页面保留本地修改。保存请求、响应和操作截图。
- I14：在文件写入、数据库提交及进程中断位置注入失败，确认服务重启后已提交角色、文件和资源绑定完整，失败候选修订不可见。保存故障测试结果和重启读回数据。
- I03–I12：以固定发布版本创建会话，读取真实 dry-run 消息并核对人物、人设、预设、开场、世界书和控制器；通过真实 SSE 核对正文、变量提交及媒体 URL。保存请求、组装结果和浏览器截图。
- I15：对指定修订创建打包任务，读取成功或失败状态，验证失败任务重试仍使用原修订；下载成功 ZIP，在独立数据环境重新导入并运行，逐文件比对内容及引用。保存下载 ZIP、任务响应、比对结果和独立运行证据。
- 主 Agent 运行项目规定的 OpenAPI 生成、SDK 生成物检查和类型检查，确认生成物与实际路由一致，保存各命令及退出结果。

## 非本次目标

旧格式转换器、多人实时编辑和通用插件平台另行实施。

## 已获得的授权

用户已批准原型并授权正式实现与联调，具体记录见 [编辑器方案第 7 章](native-card-editor.md#步骤)。
