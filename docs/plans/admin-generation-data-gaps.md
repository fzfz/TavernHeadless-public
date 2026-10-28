# 管理 Web 端生成详情的数据缺口

本文记录管理 Web 端原型尚未取得的数据及对应接口。开发缺口在本文维护，产品界面展示已有记录和实际运行状态。

## 导演输出

原型当前读取 `GET /floors/{id}/run`、`GET /floors/{id}/result` 和 `GET /floors/{id}/tool-executions`。前两个接口的响应 schema 没有导演输出字段；工具接口提供工具调用参数和结果，不能代替导演输出。

原型保留导演配置和导演工具调用。导演输出区域已有渲染入口，取得对应数据后才能展示。管理 Web 端开发者需要核对现有后端读取导演输出的接口及 schema，并将读取路径和响应字段更新到本文。

## 完整提示词

`GET /floors/{id}/prompt-runtime/explain` 的 `prompt_snapshot` 提供提示词摘要、Token 估算和资源标识，没有完整组装消息正文。原型展示该响应提供的统计和配置内容。管理 Web 端开发者需要核对完整提示词正文的读取接口及数据结构，并将结果更新到本文。前端必须使用后端提供的完整组装消息展示完整提示词正文。

## 执行事件与历史尝试

当前原型没有接入逐阶段事件数据源。操作日志使用 `GET /floors/{id}/operation-logs` 和 `GET /sessions/{id}/operation-logs`，操作日志与逐阶段执行事件分别处理。

`GET /floors/{id}/run` 提供当前运行快照及 `attempt_no`，没有返回历史尝试列表。管理 Web 端开发者需要核对历史执行详情的数据源，并将读取路径和响应字段更新到本文。前端必须依据历史尝试数据源展示历史记录。

## 核对依据

接口结构以 `apps/api/openapi/openapi.json` 为依据；运行和结果响应对应 `apps/api/src/routes/floors.ts`，`GET /floors/{id}/prompt-runtime/explain` 的响应对应 `apps/api/src/routes/schemas/prompt-runtime-schemas.ts`，工具执行响应对应 `apps/api/src/routes/tooling/tools.ts`。

上述结论仅针对当前原型读取的接口；管理 Web 端开发者需要核对其他接口是否能够补齐这些数据，并将确认后的缺口更新到本文。原型文件为 `apps/web/prototypes/admin-workspace.prototype.html`。
