---
文档用途: 提供原生角色包的导入、回读、发布和下载接口。
读取时机: 转换 Agent 核对原生 ZIP 的接口请求与响应时。
---

<!-- markdownlint-disable MD013 MD033 -->

# 原生角色卡编辑、导入与 ZIP API

本文供调用者检查和导入原生 ZIP、编辑文件、发布固定修订、创建预览及下载打包产物。SDK 使用 `client.nativeCards`，变量提案检查使用 `client.roleRuntime`。所有接口沿用当前环境的账号认证；管理调用需要管理员角色和 `project.config.write` 能力。

## 身份、文件与错误

`id` 是本机角色卡 ID，`characterId` 是本机人物资源 ID，`packageId` 是跨导入导出保留的包标识。`revision` 是一次成功保存产生的正整数。`versions[].id` 标识已发布人物版本；发布结果另返回 `releaseId`，供正式会话固定发布配置。

文件列表包含 `path`、`mediaType`、`purpose` 和 `byteSize`。文件读取返回 `path`、`mediaType`、`encoding` 和 `content`；`encoding` 为 `utf8` 时直接编辑文本，为 `base64` 时由客户端还原二进制。文件路径始终相对于包根目录。

JSON 成功响应为 `{data:结果}`。二进制下载返回 `application/zip`。失败采用现有 `{error:{code,message,details}}` 结构。包检查的 `issues` 每项包含 `code`、`path`、`message`、`action`，并按可定位范围提供 `pointer`、`line`、`column`、`operationIndex`、`expected`。前端读取统一错误码文案，问题列表显示具体文件、字段和修正操作。

| 情况                   | HTTP 结果                                                                                                                       | 客户端动作                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 无管理权限             | 403                                                                                                                             | 使用具有项目配置权限的管理员账号                                                               |
| 角色、修订或任务不存在 | 404                                                                                                                             | 刷新目录并重新选择对象                                                                         |
| 包格式或文件检查失败   | ZIP 检查返回 `status:"invalid"`；已保存修订校验返回 `valid:false`；保存或确认导入的完整包校验失败返回 422，请求结构错误返回 400 | 保留编辑内容，按 issues 修正后重新提交                                                         |
| ZIP 请求体超限         | 413                                                                                                                             | 缩减包大小后重新选择文件                                                                       |
| 预期修订过期           | 409，`NATIVE_CARD_REVISION_CONFLICT`，详情含 `expectedRevision` 和 `actualRevision`                                             | 保留本地修改，读取新修订，对照合并后再保存                                                     |
| 文件或数据库操作失败   | 500，`NATIVE_CARD_STORAGE_FAILURE`                                                                                              | 按下述详情区分写入失败和读回失败，保留本地修改并核对提交结果；导入确认使用同一检查任务重试读回 |
| 打包未完成或产物过期   | 409 或 404                                                                                                                      | 等待完成，或为原修订重新打包                                                                   |

写入失败的 `error.details` 按以下字段解释。`stage` 为 `file-commit` 或 `database-commit`；`revision` 标识本次尝试写入的候选修订。数据库事务回滚时返回 `committed:false`，表示候选修订尚未提交。`cleanupFailed:true` 表示本次目录清理失败，该标记与数据库提交结果分别记录。页面保留本地修改；已确认事务回滚时仍以原 `expectedRevision` 重试，提交结果不明时先读取角色当前修订再决定重试。读取故障使用读取对象详情，不携带写入提交结论。

## HTTP 接口

以下路径省略 API 基址。认证与管理权限按本文引言的要求检查。

| 标题及用途         | 方法与路径                                       | 输入                                                             | 输出                                                                                                                                    |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 列出可编辑角色卡   | `GET /native-cards`                              | 当前账号                                                         | `NativeCard[]`                                                                                                                          |
| 创建角色卡         | `POST /native-cards`                             | `{name,sourceVersionId?}`                                        | 已保存的 `NativeCard`；省略来源时包含最小必需文件，指定来源时复制本账号已发布版本的包内容                                               |
| 打开角色卡         | `GET /native-cards/:cardId`                      | 角色卡 ID                                                        | `NativeCard`                                                                                                                            |
| 读取文本或媒体     | `GET /native-cards/:cardId/file`                 | query `path`、可选 `revision`                                    | `NativeCardFileContent`；省略修订时读取当前已保存修订                                                                                   |
| 分配世界书条目 UID | `POST /native-cards/:cardId/entry-uids/allocate` | `{expectedRevision,bookId,reservedUids,draftBook?}`              | `{uid}`，见下文                                                                                                                         |
| 原子保存文件操作   | `PUT /native-cards/:cardId/files`                | `{expectedRevision,operations}`                                  | 新修订的 `NativeCard`                                                                                                                   |
| 校验已保存修订     | `GET /native-cards/:cardId/validation`           | 可选 query `revision`                                            | `{valid,issues}`                                                                                                                        |
| 上传并检查 ZIP     | `POST /native-cards/imports`                     | `Content-Type: application/zip`；原始 ZIP 字节；query `fileName` | `{id,fileName,packageId,name,summary,files,issues,status}`，status 为 `ready` 或 `invalid`；字段定义及 summary 为 null 的条件见本章后文 |
| 确认已检查 ZIP     | `POST /native-cards/imports/:importId/confirm`   | 检查结果 ID                                                      | 完整提交后的 `NativeCard`                                                                                                               |
| 发布指定修订       | `POST /native-cards/:cardId/publications`        | `{revision,configuration,note?}`                                 | `{id,cardId,revision,createdAt,characterId,characterVersionId,releaseId,note?}`                                                         |
| 建立隔离预览会话   | `POST /native-cards/:cardId/preview-sessions`    | `{revision,configuration,openingId?,userId?,sessionType?}`       | `{cardId,revision,sessionId,openingId}`                                                                                                 |
| 检查候选变量提案   | `POST /sessions/:id/role-state/inspect-proposal` | `{sourceMessages,proposal}`；会话已固定角色修订                  | `{before,candidate,derived,issues,valid}`，字段结构见下文                                                                               |
| 创建 ZIP 打包任务  | `POST /native-cards/:cardId/builds`              | `{source:{revision}}` 或 `{source:{versionId}}`                  | `NativeCardBuild`                                                                                                                       |
| 查询打包任务       | `GET /native-card-builds/:buildId`               | 任务 ID                                                          | `NativeCardBuild`                                                                                                                       |
| 重试失败打包       | `POST /native-card-builds/:buildId/retry`        | 任务 ID                                                          | 同一来源修订的 `NativeCardBuild`                                                                                                        |
| 下载完整 ZIP       | `GET /native-card-builds/:buildId/download`      | 已成功任务 ID                                                    | ZIP 字节                                                                                                                                |

条目新增、复制和跨书移动前，编辑器调用 `client.nativeCards.allocateEntryUid({cardId,expectedRevision,bookId,reservedUids,draftBook?})`。服务从目标书已保存的条目内容读取 UID，并排除 `reservedUids` 中当前工作区尚未保存的 UID，返回从 1 起最小可用值。新建但尚未保存的世界书传入 `draftBook`，其结构采用共享世界书 schema；服务验证该草稿后按 `reservedUids` 排除已占用值。调用只计算当前修订的候选 UID；保存接口再次验证整包与修订。当前修订已变化时返回 `NATIVE_CARD_REVISION_CONFLICT`，编辑器先处理冲突再请求分配。

文件操作使用以下三种结构：`{op:"write",path,encoding,content}` 新增或替换文件，`{op:"move",path,to}` 移动文件，`{op:"delete",path}` 删除文件。客户端同时提交受影响的清单与引用修改。全部文件操作作为一个完整包检查并保存。包结构及固定入口按目标格式参考确定。

`configuration` 包含 `presetId`、`presetVersionId`、`defaultUserId`、`promptMode`、`modelSlots` 和可选的 `model_capabilities`。能力配置字段、授权与同轮结果按[正文模型系统能力](model-capabilities.md)填写和检查。模型槽条目沿用系统角色发布的 `{slot,profile_id,params?}` 结构。该配置用于创建发布和预览会话，ZIP 导出只读取角色修订的包文件。

`note` 保存发布时填写的版本说明。`sourceVersionId` 使用发布返回的 `characterVersionId`，创建独立角色卡并以 `name` 更新其人物名称。预览的 `sessionType` 可选 `individual` 或 `group`，省略时采用 `individual`；未指定开场时使用该会话类型的默认开场。

上传与导入分两步：先检查 ZIP 并读取诊断，通过后确认导入该检查任务对应的包。检查无效的任务保留具体问题，确认接口拒绝导入。刷新编辑器只读取已提交数据。

ZIP 检查响应的 `summary` 由后端已解析的包内容生成。`formatVersion` 来自根清单；`worldbookCount`、`openingCount`、`initialStateCount` 和 `regexProfileCount` 分别记录世界书、开场、带初始状态的开场和正则配置数量；`stateUpdate`、`promptController` 和 `frontend` 标明包内实际包含的功能。包内容无法解析时 `summary` 为 `null`。

预览接口建立固定修订的会话。提示词检查随后调用 `POST /sessions/:id/respond/dry-run`，正文发送调用现有 SSE 接口，状态与历史读取现有角色 Runtime API。页面预览、文件打开及保存由对应接口完成；模型请求由用户发送操作触发。既有聊天流回调和事件继续由官方 SDK 的 `sessions.respondStream` 处理；原生角色卡接口使用请求响应与任务查询。

变量检查调用 `client.roleRuntime.inspectProposal({sessionId,input})`，读取该预览会话固定的角色版本、变量 schema、规则及模块。`sourceMessages` 至少一条，每条包含 `{messageId,revision,role,text}`，`revision` 为正整数；`proposal` 包含 `changes: [{op:"set"|"remove",path,value?}]`、`evidenceMessageIds` 和可选 `facts`。接口按正式变量提交的顺序检查证据、可写路径、状态 schema、计算函数和校验器，返回 `before`（当前变量）、`candidate`（应用提案后）、`derived`（计算函数执行后）和 `issues: [{code,message,details?}]`。尚未达到的候选或计算阶段返回 `null`；`valid` 表示完整检查是否通过。检查接口计算并返回提案检查结果，保留现有持久状态；模型请求、变量和生成记录写入由正式提交路径负责。配置、账号范围、模块读取等错误沿用 Runtime 错误；提案拒绝以 HTTP 200 的 `valid:false` 和问题数组返回。调用权限按本文引言检查。

```typescript
const inspection = await client.roleRuntime.inspectProposal({
  sessionId: preview.sessionId,
  input: {
    sourceMessages: [
      {
        messageId: "preview-1",
        revision: 1,
        role: "assistant",
        text: "沈知夏和裴修远抵达花园门口。",
      },
    ],
    proposal: {
      changes: [{ op: "set", path: "/location", value: "花园门口" }],
      evidenceMessageIds: ["preview-1"],
    },
  },
});
```

打包任务状态为 `queued`、`running`、`succeeded` 或 `failed`；阶段为 `validating`、`archiving` 或 `ready`。任务包含 `id`、`cardId`、`revision`、可选 `versionId`、创建与更新时间、问题列表，成功时提供下载地址。关闭任务窗口后编辑器可继续操作；下载来源由任务保存的修订决定。服务失败重试同一修订，内容错误修正并保存后创建新任务。

## 确认、重试与固定版本

确认导入请求将检查结果的 `id` 作为 URL 中的 `importId`；SDK 参数填写 `{importId: checked.id}`。成功确认创建对应角色卡。调用方未收到确认结果时可对同一任务重试；任务有效期内，服务返回已创建的同一张卡。其他账号、缺失或已过期任务返回 `NATIVE_CARD_IMPORT_NOT_FOUND`；已确认卡被删除时返回 `NATIVE_CARD_NOT_FOUND`。管理端关闭导入窗口、重新打开或更换 ZIP 后，只接收当前导入请求的检查结果。

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
    cardId: card.id,
    revision: card.revision,
    path: "openings/first.txt",
  });
  const saved = await client.nativeCards.save({
    cardId: card.id,
    expectedRevision: card.revision,
    operations: [
      {
        op: "write",
        path: opening.path,
        encoding: "utf8",
        content: "向导停在门边，等待裴修远回答。",
      },
    ],
  });
  const task = await client.nativeCards.createBuild({
    cardId: card.id,
    source: { revision: saved.revision },
  });
  const current = await client.nativeCards.getBuild({ buildId: task.id });
  if (current.status === "succeeded") {
    const artifact = await client.nativeCards.downloadArtifact({
      buildId: task.id,
    });
    // 页面将 artifact.blob 和 artifact.fileName 交给浏览器下载控件。
  } else if (current.status === "failed") {
    // 按 current 的问题列表修正内容，或为同一来源重试任务。
  } else {
    // 保存任务 ID，在宿主允许的查询时机继续调用 getBuild。
  }
}
```
