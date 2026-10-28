# Agent 工具定义与调用 API

本文说明模型执行角色演绎时怎样获得工具、发出调用、接收结果及留下记录。角色浏览器脚本使用[前端 API](script-api.md)；变量更新与提示词计算使用[角色卡后端 API](backend-api.md)。本页的工具调用由模型和后端执行器完成。

## 目录

- [1. 各执行入口的工具接入情况](#section-1)
- [2. 工具定义及角色关联](#section-2)
- [3. 调用参数、结果与执行上下文](#section-3)
- [4. 模型调用方法与执行时序](#section-4)
- [5. 变量工具](#section-5)
  - [5.1 get_variable：读取当前执行可见的变量](#section-5-1)
  - [5.2 set_variable：暂存本轮变量写入](#section-5-2)
  - [5.3 选择变量读取与记录查询入口](#section-5-3)
- [6. 随机与时间工具](#section-6)
- [7. 记忆与会话信息工具](#section-7)
- [8. 会话待办工具](#section-8)
- [9. 自定义脚本工具](#section-9)
- [10. 执行事件、错误与存储](#section-10)
- [11. 系统资源与动态工具目录](#section-11)
- [12. 实现依据](#section-12)

<a id="section-1"></a>

## 1. 各执行入口的工具接入情况

这里的“槽位”指后端请求模型时使用的 narrator、director、verifier、memory、state_updater 标识。槽位用于选择模型；已接入工具的入口还按槽位过滤工具。各执行入口的工具接入情况见下表。

| 执行者                  | 当前调用方式                                                    | 工具能力                                                             |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Narrator 正文生成       | TurnOrchestrator 按 narrator 筛选工具并传给生成流程             | 总开关、会话策略、工具 allowedSlots 和当前传输方式共同决定可调用列表 |
| Director 剧情指令       | Director.direct 直接请求模型输出指令                            | 工具接入状态：未接入；此入口当前返回剧情指令                         |
| Verifier 正文校验       | Verifier.verify 直接请求模型输出校验结论                        | 工具接入状态：未接入；此入口当前返回校验结论                         |
| Memory 整理、摄取、压缩 | 各处理器请求结构化文本后由服务写入                              | 工具接入状态：未接入；写记忆由处理流程完成                           |
| 角色变量更新模型        | 正常楼层更新及显式重算均由 StateUpdateService 请求 changes、facts，再运行 derive／validate | 工具接入状态：未接入；原生角色由系统专用 `state_updater` 槽选择 LLM Profile |
| 临时对话／图助手        | 临时对话服务复用聊天生成；图助手可进入多步工具循环              | 通过第 11 章的运行时目录查询实际会话可用工具                         |
| 默认后台 project.digest | 后台处理器生成摘要产物                                          | 默认实现为确定性摘要，未调用模型或工具注册表                         |

内置变量、时间、记忆、信息和待办工具的 `allowedSlots` 为 `[]`，表示定义允许所有槽位。当前主生成链实际筛选 narrator；其余入口的实际接入按上表核对。

角色脚本可通过 [recalculateLatest](script-api.md#section-5-5) 请求后端再次调用变量更新 Agent。Agent 返回[后端 API 第4章](backend-api.md#section-4)规定的结构化提案；操作结果由后端保存并通过状态事件通知页面。[restoreMissing](script-api.md#section-5-6) 由后端确定性补全初值，随后调用角色派生和校验模块。这两个入口的请求、错误及操作存储见[后端 API 第13章](backend-api.md#section-13)。

原生包的 `backend/variable-tools/` 保存后端调用的变量计算模块，函数契约见[后端 API 第 5 章](backend-api.md#section-5)。该目录文件由角色配置引用；模型可调用的工具目录仍通过本文的注册与执行接口提供。

可用条件依次包括：系统启用工具、运行时存在该定义、allowedSlots 允许当前槽位、命中已配置白名单、不在黑名单、满足副作用策略及调用次数限制。执行器会在会话目录的基础上，继续检查本次执行叠加的临时策略。

<a id="section-2"></a>

## 2. 工具定义及角色关联

### 2.1 ToolDefinition：告诉模型可以做什么

**用途**：向模型提供工具名、使用场景和参数结构，并供后端筛选与路由执行。

| 字段                  | 类型／约束                          | 实际用途                                                 |
| --------------------- | ----------------------------------- | -------------------------------------------------------- |
| `name`                | string                              | 模型发起调用的工具名，执行器据此定位提供者               |
| `description`         | string                              | 进入模型请求，说明何时应使用该工具                       |
| `parameters`          | object schema                       | 规定 args 的字段、类型和必填项                           |
| `sideEffectLevel`     | none／sandbox／irreversible         | 参与可用性和执行策略；实际落库时机须查看具体工具         |
| `allowedSlots`        | 槽位数组                            | 非空时只允许所列槽位；空数组允许所有槽位                 |
| `source`              | builtin／preset／mcp                | 运行时工具提供者类别；管理接口的同名 source 字段另见 2.2 |
| `asyncCapability`     | inline_only／deferred_ok，可省略    | 省略按 inline_only；表示是否具备后台执行能力             |
| `defaultDeliveryMode` | inline／async_job，可省略           | 省略按 inline；指定当次交付最终结果还是受理回执          |
| `resultVisibility`    | immediate／deferred_receipt，可省略 | 省略按 immediate；表示模型本轮看到的结果形态             |

`parameters` 使用 JSON Schema draft-07，根对象描述参数，支持 `oneOf`、递归引用和严格字段约束。模型必须按 `required` 提交必填字段；系统能力的参数由[正文模型系统能力](model-capabilities.md)定义。

**目录生成**：注册表返回 ToolDefinition 数组，经第 1 章筛选后加入模型请求。

**执行时序**：后端准备请求时读取定义，收到模型工具调用后执行对应提供者。

`sideEffectLevel=none` 表示查询或计算；sandbox 表示声明为受系统管理的写入；irreversible 表示按不可自动回滚的写入管理。判断事务行为时，按各条目核对具体提供者的落库时机。

**存储**：内置工具定义在代码中；角色、预设和自定义工具登记在 `tool_definition` 表；MCP 工具由已配置的提供者提供。

**错误处理**：同名冲突会阻止正常构建目录；核对冲突工具的 providerId 并修正重复名字。脚本执行策略关闭时，相关工具显示为 unavailable；作者以 available 且通过本次策略检查的工具作为调用候选。

**实际使用示例**：后端先列出 narrator 当前可用定义，模型再按列出的 schema 提交参数。

```typescript
// registry 和 permissions 由第 3.2 节的完整示例建立。
const definitions = await registry.listForSlot("narrator", permissions);
const random = definitions.find((item) => item.name === "random");
console.log(random?.parameters);
```

系统能力的参数定义读取[同一契约](model-capabilities.md#启用能力)，包含严格字段、联合类型和递归表达式。

角色关联脚本工具的登记请求与模型调用见第 9 章。

### 2.2 角色、预设与自定义来源

管理接口的 `source` 使用 character／preset／custom，表示这条定义关联角色、预设还是自定义范围；运行时 `ToolDefinition.source` 使用 builtin／preset／mcp，表示执行提供者类别。三种管理定义都由 PresetToolProvider 执行，因此它们的运行时 source 均为 preset。运行时目录另外保留来源分类，以便区分角色、预设及 custom 定义。

会话工具注册服务读取已启用且 `handlerType=script` 的定义。source 为 character 时 sourceId 匹配会话 characterId；source 为 preset 时匹配会话 presetId；custom 为当前账户及工作区筛选后的自定义定义。

作者通过工具管理接口登记定义，当前服务从 `tool_definition` 加载。工具管理接口的字段、创建和查询方式见[工具管理 API](../../vitepress/reference/api/tools.md)。

<a id="section-3"></a>

## 3. 调用参数、结果与执行上下文

### 3.1 ToolCallResult：一次执行的返回数据

```typescript
type ToolCallResult = {
  data?: unknown;
  error?: string;
  executionStatus?:
    | "success"
    | "error"
    | "denied"
    | "queued"
    | "running"
    | "timeout"
    | "uncertain"
    | "blocked";
  executionReasonCode?: string;
  reconnectRequired?: boolean;
  retryable?: boolean;
  providerMessage?: string;
};
```

| 字段                  | 用途与条件                                             |
| --------------------- | ------------------------------------------------------ |
| `data`                | 成功时的业务结果，各工具分别定义；后台交付时是受理回执 |
| `error`               | 本次失败的说明；执行器据此进入失败处理                 |
| `executionStatus`     | 执行状态；queued 表示等待后台执行；各状态见下表        |
| `executionReasonCode` | 提供者给出的原因码，用于区分失败原因；未提供时省略     |
| `reconnectRequired`   | 提供者是否要求重连；true 时由调用方重新建立连接        |
| `retryable`           | 提供者给出的重试建议；true 表示调用方可发起重试        |
| `providerMessage`     | 提供者的额外诊断文本，供执行详情定位问题               |

| executionStatus | 含义与阶段                                               | 调用方如何处理                           |
| --------------- | -------------------------------------------------------- | ---------------------------------------- |
| `queued`        | 请求已受理，等待后台执行；业务结果尚未返回               | 用 execution_id、job_id 查询后续执行     |
| `running`       | 记录已进入执行阶段，尚未结束                             | 等待完成并查看执行记录                   |
| `success`       | 提供者返回成功，调用结束                                 | 使用 data；另外核对本轮提交结果          |
| `error`         | 提供者返回业务错误或执行抛出异常                         | 阅读 error 和原因码，修正参数或执行条件  |
| `denied`        | 执行器在调用提供者前拒绝请求                             | 按第 10.2 节修正工具可用性或策略         |
| `timeout`       | 执行返回超时结论                                         | 查询实际业务对象和执行详情后决定是否重试 |
| `uncertain`     | 无法确定执行是否已在提供者侧产生结果                     | 核对业务对象及来源记录，避免重复执行     |
| `blocked`       | 执行被运行条件阻断，例如开始日志写入失败且提供者尚未执行 | 核对原因码、持久化或提供者条件           |

后端 `ToolExecutor.execute` 返回 `Promise<ToolCallResult & { denied?: ToolDenyReason }>`。执行器拒绝调用时，`denied` 标明具体拒绝原因，取值及处理方式见第 10.2 节。

本文通用工具条目的“输出”描述 data 内容。正文系统能力的 data 保存[统一模型结果](model-capabilities.md)，其中 ok 标明成功或失败。失败同时返回 error；可选字段缺省时读取值为 undefined。所有工具都还可能被执行器拒绝，原因见第 10 章。

**实际结果处理示例**：以下是后端集成代码；executor、context、permissions 由后端装配，建立方式见第 3.2 节。

```typescript
const result = await executor.execute(
  "calculate",
  { expression: { op: "div", args: [1, 0] } },
  context,
  permissions,
);
if (result.error) {
  console.error(result.executionStatus, result.error);
  // 结果的 executionReasonCode 为 DIVISION_BY_ZERO。
} else {
  console.log(result.data);
}
```

**示例结果**：执行状态为 error，错误码为 DIVISION_BY_ZERO；模型取得包含该错误码的完整结果。

### 3.2 ToolExecutionContext：系统提供执行归属

此对象由后端执行器传给工具提供者，标明本次调用的会话、楼层及变量范围。

| 字段               | 类型／是否必有      | 用途                                                |
| ------------------ | ------------------- | --------------------------------------------------- |
| `sessionId`        | string，必有        | 定位当前会话，供变量、记忆和待办工具使用            |
| `accountId`        | string，可省略      | 资源与待办查询的账户归属；这些工具实际要求有值      |
| `branchId`         | string，可省略      | 当前剧情分支                                        |
| `floorId`          | string，必有        | 将执行记录关联本轮对话                              |
| `pageId`           | string，可省略      | 已知消息页时关联具体页；工具可能早于输出页创建      |
| `callerSlot`       | 槽位，必有          | 权限筛选及调用记录中的执行者标识                    |
| `variableContext`  | 对象，必有          | 变量解析所用 page／floor／branch／chat／global 范围 |
| `abortSignal`      | AbortSignal，可省略 | 传递取消请求；实际响应由提供者执行逻辑决定          |
| `callId` | string，可省略 | 关联模型协议中的调用 ID。 |
| `generationAttemptNo` | number，可省略 | 标记正文生成尝试，从 1 开始。 |
| `generationStepNo` | number，可省略      | 标记多步生成中的第几步，从 1 开始，供记录与重试定位 |

`variableContext` 的可选字段分别是：pageId 定位页范围，floorId 定位楼层范围，branchId 与 sessionId 共同定位分支，sessionId 同时定位聊天范围，accountId 限定账户，globalScopeId 选择全局范围（默认 global）。

**执行器内部字段**：执行器调用提供者前，在上下文中注入 toolMutationBuffer 和 toolMutationAttemptNo，分别用于暂存变量写入和标记生成尝试。调用方使用上表中的输入字段。

**后端接入片段**：调用方先从 apps/api/config/role-model-capabilities.json 加载 systemConfig，并从会话固定快照取得 grant，再将下列代码接入后端，调用统一随机采样工具。

```typescript
import {
  RoleModelCapabilitiesToolProvider,
  ToolRegistry,
  ToolExecutor,
  createEventBus,
} from "@tavern/core";
// systemConfig 从 apps/api/config/role-model-capabilities.json 加载，grant 来自会话固定快照。
const registry = new ToolRegistry();
registry.register(new RoleModelCapabilitiesToolProvider({ systemConfig, grant, resolveGrant: () => grant }));
const bus = createEventBus();
const executor = new ToolExecutor(registry, bus);
const context = {
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  callerSlot: "narrator" as const,
  variableContext: {
    sessionId: "session-1",
    branchId: "main",
    floorId: "floor-1",
  },
};
const permissions = { enabled: true, maxCallsPerTurn: 5 };
const result = await executor.execute(
  "random",
  { domain: { kind: "integer_range", min: 1, max: 1 }, distribution: { kind: "uniform" }, count: 2, replacement: true },
  context,
  permissions,
);
console.log(result.data); // { ok: true, data: { samples: [1, 1], indices: null } }
```

本例把执行记录保存在内存中；正式服务器装配执行记录仓库后按第 10 章持久化。

可运行的完整示例见 [run-tools.ts](./examples/api-usage/run-tools.ts)，包含成功、参数错误、权限拒绝、完成事件和执行记录读取。在仓库根目录运行：

```sh
pnpm exec tsx docs/character-authoring/examples/api-usage/run-tools.ts
```

输出中 success.data.samples 为 [1,1]，failure.status 为 error，denied 为 disabled；completed 包含成功的 random，records 保留成功、错误和拒绝记录。此示例直接调用本地执行器。

<a id="section-4"></a>

## 4. 模型调用方法与执行时序

### 4.1 原生工具调用

系统把工具描述和参数 schema 放入模型请求。模型通过供应商的 function calling 返回名称与 args；执行器接收调用，找到提供者，返回结果给生成流程。角色作者在预设中说明使用条件，实际参数遵守对应工具 schema。

正式角色通过 random 采样、calculate 运算；完整参数和结果见[正文模型系统能力](model-capabilities.md)。

包含点号等字符的工具名在原生通道可能被映射为供应商接受的名称；执行前恢复原名，执行记录使用原工具名。模型使用本次请求实际提供的 schema 名称。

### 4.2 文本协议调用

当本轮选择 text_protocol 时，模型按系统提供的工具列表输出：

```text
<tool_call id="call_1" name="random">
{"args":{"domain":{"kind":"integer_range","min":1,"max":6},"distribution":{"kind":"uniform"},"count":2,"replacement":true}}
</tool_call>
```

id 区分本次调用，name 必须在本轮列表中，args 是 JSON 对象。第 5–9 章的模型调用和工具结果示例使用本协议，前提是本轮已选择 text_protocol 并开放对应工具。

正式角色的两种工具协议都在同轮执行、回传并续写，最终正文和状态证据按[正文模型系统能力](model-capabilities.md#同轮结果和状态证据)关联。图助手按其多步循环配置执行；其他未启用系统能力的普通文本路径沿用结束后执行及回写。

### 4.3 结果交付及保存顺序

inline 工具在当前生成过程中等待提供者完成，返回最终 data 或 error。async_job 仅在工具声明及运行时策略允许时使用，返回如下 data：

```json
{
  "accepted": true,
  "delivery_mode": "async_job",
  "execution_id": "execution-1",
  "job_id": "job-1",
  "status": "queued",
  "message": "工具请求已受理，等待后台执行。"
}
```

示例 message 用于说明含义，实际文案由运行时产生。accepted 表示受理；delivery_mode 指示后台交付；execution_id 用于查询执行详情；job_id 用于查询后台作业；status 表示排队阶段；message 为受理说明。

async_job 请求先保存在本轮内存缓冲中，楼层成功提交后才进入 `runtime_job`。作者须区分受理、后台完成及业务数据写入，queued 对应受理阶段，最终结果应从执行详情读取。第 5–9 章的工具使用 inline 交付：调用结果返回给模型，后端执行事件见第 10.1 节。各工具的执行记录按第 10.3 节保存。

<a id="section-5"></a>

## 5. 变量工具

<a id="section-5-1"></a>

### 5.1 get_variable：读取当前执行可见的变量

**用途**：让模型在行动判断前读取会话状态，例如 stat_data 中的地点或精力。

**输入**：`{key: string}`；key 必填且非空，填写完整变量键，例如 stat_data。

**输出**：`{key, value}`。key 是查询键；value 是按当前变量范围解析的值，未找到时为 null。

**读取规则**：从 variable 表按 page → floor → branch → chat → global 范围解析值；当前生成尝试暂存的工具写入优先于已保存的 page 值。

**错误**：变量存储未装配或 key 为空时返回 error；核对系统配置与参数。

**调用示例**：

```text
<tool_call id="call-get_variable" name="get_variable">
{"args":{"key":"stat_data"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get_variable" name="get_variable" status="success">
{
  "data": {
    "key": "stat_data",
    "value": {
      "location": "大厅",
      "energy": 10
    }
  }
}
</tool_result>
```

**结果使用**：后续模型请求收到结果后，读取 data.value.location 得到大厅，再判断是否需要询问当前位置。结果交付时机见第 4.2 节。

<a id="section-5-2"></a>

### 5.2 set_variable：暂存本轮变量写入

**用途**：让模型记录本轮产生的信息，供后续变量查询使用。

| 输入字段 | 类型／默认                               | 用途                                                                  |
| -------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `key`    | string，必填非空                         | 要写入的变量键                                                        |
| `value`  | 对模型公开的 schema 为 string，必填      | 按工具公开 schema 提交的字符串值                                      |
| `intent` | 字符串，可选；promote_to_floor_on_accept | promote_to_floor_on_accept 接受后提升到楼层；page_only 只保留在页范围 |
| `reason` | string，可选；builtin:set_variable       | 写入原因，随暂存写入保存                                              |

**输出**：`{key,value,scope,intent,reason}`。key/value 为暂存项；scope 是变量范围；intent/reason 是实际采用的写入意图与原因。

**执行时序**：提供者先暂存本次写入，再返回结果；后端事件见第 10.1 节。

**存储**：ToolExecutor 在生成期间缓冲写入；被拒绝的生成尝试会丢弃自己的缓冲。正文接受后，提交服务把暂存值写入 variable 表的 page 范围；intent 为 promote_to_floor_on_accept 时同时提升到 floor 范围。

**错误**：存储未装配或 key 为空时返回 error；由维护者检查变量存储装配，调用方填写非空 key。

**调用示例**：

```text
<tool_call id="call-set_variable" name="set_variable">
{"args":{"key":"last_action","value":"检查仓库","intent":"page_only"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-set_variable" name="set_variable" status="success">
{
  "data": {
    "key": "last_action",
    "value": "检查仓库",
    "scope": "page",
    "intent": "page_only",
    "reason": "builtin:set_variable"
  }
}
</tool_result>
```

**结果使用**：本次写入已暂存；后续模型请求收到结果后继续生成正文，结果交付时机见第 4.2 节。后端维护者通过第 10.3 节的 commitOutcome 核对提交结果。

<a id="section-5-3"></a>

### 5.3 选择变量读取与记录查询入口

模型调用工具时，后端根据本轮执行上下文解析变量；角色页面回看时，前端根据用户选择的记录标识读取已保存数据。调用者按所需对象选择入口：

| 调用者与用途 | 调用入口 | 输入与获得的结果 |
| --- | --- | --- |
| 模型为后续生成读取变量 | 本章 `get_variable` | 提交变量 `key`，获得当前执行上下文解析的 `value`；字段和示例见第 5.1 节 |
| 角色页面展示过去的对话 | [前端对话 API](script-api.md#section-6) | 通过 `messages.listFloors` 分页取得楼层标识，再用 `messages.getFloor` 读取消息 |
| 角色页面回看过去的变量状态 | [前端历史状态 API](script-api.md#section-9-3) | 通过 `history.listSnapshots` 分页取得快照标识，再用 `variables.getSnapshot(snapshotId)` 读取完整变量记录 |
| 后端维护者排查一次工具调用 | 第 10.3 节的执行记录查询 | 按楼层定位工具参数、结果与 `commitOutcome`，核对该次写入的提交结果 |

例如，模型用 `get_variable` 读取调用上下文可见的精力值，后续模型请求收到结果后据此决定行动；用户在页面选择上一份变量状态时，页面使用该记录的 `snapshotId` 读取当时的精力值。角色变量更新的保存时序及两种历史列表的验收条件见[后端变量更新与保存验收](backend-api.md#section-11-2)。

<a id="section-6"></a>

## 6. 随机与时间工具

本章工具由模型发起调用。世界书条目的概率筛选和同组加权选择由提示词组装器读取条目配置后执行；配置方法见 [世界书条目的生成条件](../../vitepress/reference/api/worldbooks.md#条目的生成条件)。

### 6.1 random 与 calculate：正文模型的系统能力

正式角色使用统一 random 参数表达骰子、区间和候选抽样，使用 calculate 表达数值运算。启用配置、参数、额度、同轮回传和状态证据以[正文模型系统能力](model-capabilities.md)为准。

### 6.2 get_time：读取服务器当前时间

**用途**：模型需要现实时间时取得服务器当前时刻。

**输入**：空对象 `{}`。

**输出**：`{iso,unix,readable}`；iso 为 UTC ISO 字符串；unix 为 Unix 毫秒数；readable 为服务器本地格式文本，受运行环境地区设置影响。

**调用示例**：

```text
<tool_call id="call-get_time" name="get_time">
{"args":{}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get_time" name="get_time" status="success">
{
  "data": {
    "iso": "2026-09-28T00:00:00.000Z",
    "unix": 1790553600000,
    "readable": "2026/9/28 08:00:00"
  }
}
</tool_result>
```

**结果使用**：模型从 iso 读取 UTC 时刻 2026-09-28 00:00:00；本例 readable 为 UTC+8 地区的对应时间。

<a id="section-7"></a>

## 7. 记忆与会话信息工具

### 7.1 query_memory：读取会话记忆条目

**用途**：模型查询已经保存的摘要、事实、事件或关系记忆，补充当前叙述所需信息。

| 输入字段        | 类型／默认       | 用途                                           |
| --------------- | ---------------- | ---------------------------------------------- |
| `type`          | string，可选     | 按 summary、fact、event、relationship 类型筛选 |
| `limit`         | number，可选；10 | 返回数量，处理器取整并限制 1–50                |
| `minImportance` | number，可选     | 最低重要度条件，传给记忆查询                   |

**输出**：`{count,items}`。count 为本次条目数；每项 id 是记忆 ID，type 是类型，content 是内容，importance 是重要度。结果按重要度降序排列。

**数据来源**：MemoryStore 从 memory_item 表读取当前 sessionId、accountId 范围的记忆。

**错误**：MemoryStore 未装配时直接执行返回 `MemoryStore not available`，由后端维护者核对记忆功能装配。

**调用示例**：

```text
<tool_call id="call-query_memory" name="query_memory">
{"args":{"type":"fact","limit":5}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-query_memory" name="query_memory" status="success">
{
  "data": {
    "count": 1,
    "items": [
      {
        "id": "memory-1",
        "type": "fact",
        "content": "仓库钥匙放在前台抽屉。",
        "importance": 0.8
      }
    ]
  }
}
</tool_result>
```

**结果使用**：后续模型请求收到结果后，读取 items[0].content，结合请求上下文决定是否去前台取钥匙；count=0 时没有符合筛选条件的记忆。结果交付时机见第 4.2 节。

### 7.2 get_character_info：读取当前工具上下文中的会话标识

**用途**：让模型取得当前会话 ID，用于需要明确会话归属的后续操作。

**输入**：可选 field:string，默认 all。

**输出**：field=all 返回 `{sessionId}`；指定字段返回 `{[field]:value}`，当前只有 sessionId 有值，其他字段为 null。

**数据来源**：读取 ToolExecutionContext.sessionId。

**调用示例**：

```text
<tool_call id="call-get_character_info" name="get_character_info">
{"args":{"field":"sessionId"}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get_character_info" name="get_character_info" status="success">
{
  "data": {
    "sessionId": "session-1"
  }
}
</tool_result>
```

**结果使用**：模型取得 session-1，可在需要会话 ID 的后续调用中使用该值。

<a id="section-8"></a>

## 8. 会话待办工具

### 8.1 update_todo_list：写入当前会话待办清单

**用途**：让模型记录需要继续执行的事项及进度，供后续调用读取。

| 输入字段         | 类型／默认                     | 用途                                                    |
| ---------------- | ------------------------------ | ------------------------------------------------------- |
| `mode`           | rewrite／update，可选；rewrite | rewrite 替换清单；update 按 id 优先、否则按标题匹配合并 |
| `items`          | 对象数组，必填                 | 本次写入的事项                                          |
| `items[].id`     | string，可选                   | 更新已有事项的稳定标识                                  |
| `items[].title`  | string，新事项必填             | 任务标题                                                |
| `items[].status` | 枚举，可选；新项 pending       | pending、in_progress、completed、blocked、cancelled     |
| `items[].note`   | string，可选                   | 备注                                                    |
| `items[].delete` | boolean，可选                  | update 模式中删除匹配事项                               |

**输出**：`{items,counts,revision}`。items 每项含 id、title、status 和可选 note；counts 含 total 及上述五个状态的数量；revision 是清单修订号，首次写入为 1，后续写入递增。

**执行时序**：待办服务完成写入后返回清单。

**存储**：`session_todo_list` 每会话一行。提供者调用待办服务直接保存清单，事务归属待办服务；正文被拒绝时，已提交的清单保留。

**错误**：缺少 accountId、无对应会话、非法 mode、items 不是数组或事项校验失败时返回 error。核对上表中的 mode、事项 ID、新项 title 和 status；详细约束见[会话待办接口](../../vitepress/reference/api/tools.md)。

**调用示例**：

```text
<tool_call id="call-update_todo_list" name="update_todo_list">
{"args":{"mode":"rewrite","items":[{"title":"检查仓库","status":"pending"}]}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-update_todo_list" name="update_todo_list" status="success">
{
  "data": {
    "items": [
      {
        "id": "todo-1",
        "title": "检查仓库",
        "status": "pending"
      }
    ],
    "counts": {
      "total": 1,
      "pending": 1,
      "in_progress": 0,
      "completed": 0,
      "blocked": 0,
      "cancelled": 0
    },
    "revision": 1
  }
}
</tool_result>
```

**结果使用**：本例清单已写入一项，后续更新传回返回的 id；实际 id 由服务生成。

### 8.2 get_todo_list：读取当前会话待办清单

**用途**：让模型依据已保存的事项和状态选择后续工作。

**输入**：空对象 `{}`。

**输出**：与 8.1 相同的 items、counts、revision；当前会话尚无记录时返回空清单和 revision=0。

**数据来源**：读取当前会话的 session_todo_list 记录。

**错误**：缺少 accountId 或会话不属于当前账户时返回 error；由调用端核对执行上下文。

**调用示例**：

```text
<tool_call id="call-get_todo_list" name="get_todo_list">
{"args":{}}
</tool_call>
```

**结果示例**：

```text
<tool_result id="call-get_todo_list" name="get_todo_list" status="success">
{
  "data": {
    "items": [
      {
        "id": "todo-1",
        "title": "检查仓库",
        "status": "pending"
      }
    ],
    "counts": {
      "total": 1,
      "pending": 1,
      "in_progress": 0,
      "completed": 0,
      "blocked": 0,
      "cancelled": 0
    },
    "revision": 1
  }
}
</tool_result>
```

**结果使用**：模型读取 pending 事项继续执行；revision 用于识别此次读取的列表版本。

<a id="section-9"></a>

## 9. 自定义脚本工具

**用途**：为角色、预设或 custom 范围的工具定义提供同步计算，例如根据输入值计算差额。

**定义输入**：工具管理接口创建定义时提供以下字段，具体 HTTP 约束见工具管理 API。

| 字段                                | 用途                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `name`、`description`、`parameters` | 工具名称、模型使用说明与输入 schema，含义见 2.1                                                             |
| `source`、`source_id`               | source 选择 character、preset 或 custom；source_id 在前两种来源中填写对应 ID，custom 可省略；匹配规则见 2.2 |
| `handler_type`                      | 当前公开创建接口支持 script                                                                                 |
| `handler.script`                    | 同步 JavaScript 函数体，以 args 作为唯一入参                                                                |
| `allowed_slots`                     | 定义允许调用的槽位，匹配规则见第 1 章                                                                       |
| `side_effect_level`                 | 工具副作用声明，含义见 2.1                                                                                  |
| `enabled`                           | 是否参与运行时定义加载                                                                                      |

**调用签名**：模型调用已登记的 name，并提交符合 parameters 的 args。脚本通过 args 读取全部输入。

**输出**：同步返回业务值，提供者将其包装为 {data:返回值}。

**创建请求示例**：以下为工具管理接口请求体。source_id 须替换为会话绑定的 characterId。

```json
{
  "name": "remaining_points",
  "description": "计算给定总积分扣除已使用积分后的剩余值。",
  "source": "character",
  "source_id": "character-1",
  "parameters": {
    "type": "object",
    "properties": {
      "total": { "type": "number" },
      "used": { "type": "number" }
    },
    "required": ["total", "used"]
  },
  "handler_type": "script",
  "handler": { "script": "return { remaining: args.total - args.used };" },
  "allowed_slots": ["narrator"],
  "side_effect_level": "none",
  "enabled": true
}
```

**实际登记调用**：把上述 JSON 保存为 tool-definition.json，在已配置 API 访问方式的本机环境提交。API_BASE 指向实际后端地址；执行该命令会登记工具定义。

```sh
curl --fail-with-body -X POST "$API_BASE/tools/definitions" \
  -H 'Content-Type: application/json' \
  --data-binary @tool-definition.json
```

服务返回 HTTP 201。以下展示响应中用于后续查询的字段；id 为示意值，实际值由服务生成：

```json
{
  "data": {
    "id": "tool-1",
    "name": "remaining_points",
    "source": "character",
    "source_id": "character-1",
    "enabled": true,
    "handler_type": "script"
  }
}
```

完整响应还包含提交的 description、parameters、side_effect_level、allowed_slots、handler，以及 created_at 和 updated_at；字段定义见[工具管理 API](../../vitepress/reference/api/tools.md)。通过第 11 章的运行时目录确认工具可用。若服务启用了访问认证，请使用该环境已经配置的认证请求头。

**模型实际调用**：

```text
<tool_call id="call-points" name="remaining_points">
{"args":{"total":20,"used":7}}
</tool_call>
```

**对应结果**：

```text
<tool_result id="call-points" name="remaining_points" status="success">
{"data":{"remaining":13}}
</tool_result>
```

后续模型请求收到工具结果后，使用 remaining=13 回答剩余积分；结果交付时机见第 4.2 节。该字段是本次脚本返回值，角色持久变量仍由相应写入流程更新。

**执行时序**：脚本同步计算完成后，提供者交付工具结果；执行事件见第 10.1 节。

**存储**：定义保存在 tool_definition；结果进入工具执行记录。

**错误处理**：服务端必须已开启 `ENABLE_UNSAFE_SCRIPT_HANDLER` 才能创建／执行此类定义；关闭时由维护者核对该配置。脚本为空或抛异常返回 error。

<a id="section-10"></a>

## 10. 执行事件、错误与存储

### 10.1 后端执行事件

这些事件由 CoreEventBus 供后端及聊天流桥接使用，角色前端 `api.events.on` 的可用事件来自浏览器 window 或 document。

| 事件                              | 时机                             | 事件特有数据                                                         |
| --------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `tool.call_started`               | inline 工具调用提供者之前        | args：本次参数                                                       |
| `tool.call_completed`             | 提供者成功且记录完成后           | result：业务结果；status=success；durationMs：耗时                   |
| `tool.call_failed`                | 提供者失败或执行异常             | error：Error；status：error／timeout／uncertain／blocked；durationMs |
| `tool.call_denied`                | 执行器拒绝调用                   | status=denied；reason：拒绝原因                                      |
| `tool.call_awaiting_confirmation` | 图助手循环按已配置策略暂停调用时 | callId、toolName、args；可带 confirmationId；尚未执行工具            |

前四类事件共有 floorId、可选 pageId、callerSlot、executionId、providerId、providerType、可选 sideEffectLevel、toolName。floorId/pageId 定位消息归属；executionId 定位本次调用记录；providerId/providerType 定位执行提供者；其他字段用途见第 2、3 章。等待确认事件可能尚无 executionId，用 callId 关联待处理调用。

**实际事件订阅示例**：以下代码放在第 3.2 节示例的 executor.execute 之前，执行后即可观察回调。CoreEventBus 位于后端。

```typescript
const onCompleted = (event) => {
  console.log(
    event.toolName,
    event.executionId,
    event.result,
    event.durationMs,
  );
};
const stop = bus.on("tool.call_completed", onCompleted);
await executor.execute(
  "random",
  { domain: { kind: "integer_range", min: 1, max: 1 }, distribution: { kind: "uniform" }, count: 2, replacement: true },
  context,
  permissions,
);
stop();
```

**示例输出**：random 事件携带 samples=[1,1]、indices=null 的成功结果。execution-1 和耗时 3 毫秒为示意值，以实际返回为准。随后调用 stop 解除监听。

### 10.2 拒绝与失败

| 拒绝原因               | 情况                     | 处理方式                       |
| ---------------------- | ------------------------ | ------------------------------ |
| `disabled`             | 工具总开关关闭           | 核对本次运行工具设置           |
| `tool_not_found`       | 定义或提供者不存在       | 使用本轮实际目录中的名称       |
| `slot_not_allowed`     | 定义不允许当前槽位       | 核对 allowedSlots 及实际调用者 |
| `deny_listed`          | 命中槽位黑名单           | 核对会话及运行策略             |
| `not_in_allow_list`    | 未列入已配置白名单       | 核对需要启用的工具名           |
| `max_calls_exceeded`   | 本轮调用数达到限制       | 停止继续请求，检查循环及配置   |
| `irreversible_blocked` | 当前策略不允许该类副作用 | 核对工具定义和运行设置         |

提供者执行失败时的状态和处理方式见第 3.1 节。

**拒绝处理示例**：复用第 3.2 节的 executor、context。

```typescript
const result = await executor.execute("random", {}, context, {
  enabled: false,
});
console.log(result.denied); // disabled
console.log(result.error); // 执行器给出的拒绝说明
```

本例在权限检查阶段返回 disabled。

### 10.3 执行记录与业务数据分别存储

`tool_execution_record` 保存每次调用的主执行记录；`tool_call_record` 保存按消息页查询的调用记录副本。异步执行另外关联 `runtime_job`。主要定位字段如下。

| 字段（执行器结构）                                     | 用途                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `id`、`runId`、`floorId`、可选 `pageId`                | 定位调用、所属运行及消息位置                                                           |
| `callerSlot`、`providerId`、`providerType`、`toolName` | 标明谁调用、由谁执行及调用什么工具                                                     |
| `argsJson`、`resultJson`                               | 当次参数及结果的 JSON 文本                                                             |
| `status`                                               | 这次执行的状态，枚举见 3.1                                                             |
| `lifecycleState`                                       | opened 表示已登记开始，finished 表示记录已结束                                         |
| `commitOutcome`                                        | pending／committed／discarded／replay_blocked／uncertain，表示该执行在轮次提交中的归宿 |
| `deliveryMode`、`runtimeJobId`                         | 区分 inline 与 async_job，并关联后台作业                                               |
| `sideEffectLevel`、`errorMessage`                      | 当次副作用分类及错误说明                                                               |
| `startedAt`、`finishedAt`、`durationMs`、`createdAt`   | 开始、结束、耗时及记录创建时间；时间戳单位为毫秒                                       |
| `attemptNo`、`replayParentExecutionId`                 | 工具执行序号及重放来源                                                                   |
| `generationStepNo`                                     | 多步模型调用中的步骤号；有值时用于定位生成步骤                                         |

内部可选字段在 HTTP 查询中可能映射为 null，准确返回结构见工具管理 API。工具成功与楼层提交是不同状态，例如 set_variable 可以执行成功后因候选正文被拒绝而丢弃暂存写入。

业务数据由具体提供者保存：变量工具走变量提交链；待办工具直接写 session_todo_list；资源工具的数据位置见第 11 章；MCP 工具的业务结果由外部提供者决定。排查时用执行日志定位调用，再读取对应业务对象核对保存结果。

**实际记录读取示例**：在后端诊断代码中执行工具后读取执行器的当前回合记录。持久化查询使用 `GET /floors/:id/tool-executions`，请求和返回字段见[工具管理 API](../../vitepress/reference/api/tools.md)。

```typescript
// executor 为第 3.2 节创建并执行过工具的对象。
for (const record of executor.getExecutionRecords()) {
  console.log(record.id, record.toolName, record.status);
  console.log(JSON.parse(record.argsJson), JSON.parse(record.resultJson));
}
```

**示例结果**：第 3.2 节调用的记录中，toolName 为 random，status 为 success；resultJson 保留实际统一模型结果对象，执行身份由本次调用记录提供。

<a id="section-11"></a>

## 11. 系统资源与动态工具目录

系统还注册 ResourceToolProvider，并按项目上下文加入 NodeGraph 工具、配置的 MCP 和已登记脚本工具。这些集合与会话绑定资源及项目配置有关。

| 工具来源               | 用途                                       | 定义来源                                       | 业务数据位置                                                                                                               |
| ---------------------- | ------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 资源工具               | 读取或编辑角色、世界书、正则、预设及长文本 | apps/api/src/tools/resource-tool-provider.ts   | character／character_version、worldbook／worldbook_entry、preset、regex_profile 及各资源版本表；长文本保存在对应资源字段中 |
| NodeGraph 工具         | 查询节点、检查图、编辑草稿并提交提案       | apps/api/src/tools/node-graph-tool-provider.ts | 草稿保存在内存，提案写入 project_inbox                                                                                     |
| MCP                    | 调用已连接服务提供的工具                   | 当前会话运行时目录及服务参数 schema            | 由对应外部提供者保存                                                                                                       |
| 角色、预设及自定义脚本 | 执行登记的同步脚本                         | 第 9 章                                        | 定义保存在 tool_definition；执行结果见第 10.3 节                                                                           |

资源编辑和 NodeGraph 的参数 schema 来源见上表所列实现文件和运行时目录。查询当前可用目录用 `GET /sessions/:id/tools/runtime`；定义管理、执行详情和会话权限见[工具管理 API](../../vitepress/reference/api/tools.md)。目录中的 availability 表示可用状态，allowedSlots 表示允许的模型槽位，deliveryMode 表示交付方式，实际调用参数仍按具体工具输入 schema 填写。

<a id="section-12"></a>

## 12. 实现依据

维护者核对本文接口实现时，按下表定位源文件。

| 内容                         | 实现文件                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 定义、上下文、结果、权限类型 | `packages/core/src/tools/types.ts`                                                                                                                                  |
| 槽位筛选                     | `packages/core/src/tools/tool-registry.ts`                                                                                                                          |
| 主生成接入及传输分支         | `packages/core/src/orchestration/turn-orchestrator.ts`                                                                                                              |
| 内置工具输入与处理           | `packages/core/src/tools/builtin-provider.ts`                                                                                                                       |
| 自定义脚本执行               | `packages/core/src/tools/preset-provider.ts`                                                                                                                        |
| 会话关联定义加载             | `apps/api/src/services/tooling/session-tool-registry-service.ts`                                                                                                    |
| 待办工具与持久化             | `apps/api/src/tools/todo-tool-provider.ts`、`apps/api/src/services/session-todo-list-service.ts`                                                                    |
| 执行、拒绝、事件与缓冲       | `packages/core/src/tools/tool-executor.ts`、`packages/core/src/tools/tool-mutation-buffer.ts`                                                                       |
| 事件字段                     | `packages/core/src/events/event-types.ts`                                                                                                                           |
| 提交与记录                   | `apps/api/src/services/turn-commit-service.ts`、`apps/api/src/db/schema.ts`                                                                                         |
| Director／Verifier 请求      | `packages/core/src/orchestration/director.ts`、`packages/core/src/orchestration/verifier.ts`                                                                        |
| 记忆模型请求                 | `packages/core/src/memory/memory-consolidator.ts`、`packages/core/src/memory/memory-ingest-processor.ts`、`packages/core/src/memory/memory-compaction-processor.ts` |
