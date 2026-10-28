---
文档用途: 说明转换Agent调用各命令的时机、输入和结果读取方法。
读取时机: 调用转换脚本或处理命令结果时。
---

<!-- markdownlint-disable MD013 -->

# 转换工具

## 1. 调用入口与结果读取

1. 转换Agent在Skill目录调用`node scripts/convert.mjs`。完整参数说明通过`--help`或`<命令> --help`取得。
2. 命令成功时，stdout返回`resultFile`；转换Agent读取该文件中的`data`。命令失败时，stderr返回`diagnosticFile`，退出码非零；处理方法见第3章。
3. 命令结果中的`bytes`表示结果文件的字节数。存在`partsDirectory`时，Agent按文件名编号顺序读取全部分片；完整结果文件供程序读取。
4. 任务目录是`taskFile`所在目录。原生文件写入`packageDirectory`，必要辅助文件写入任务目录。写入命令的目标路径相对于`packageDirectory`，也可使用包内绝对路径。状态写入命令、以状态文件为目标的`copy`和`parse`命令，以及页面宏绑定命令均返回独立任务；转换Agent将成功结果中的`taskFile`与`packageDirectory`作为后续操作对象。需要累积修改时，转换Agent沿返回任务逐次调用。
5. JSON Pointer以`/`分隔字段，字段名中的`~`和`/`分别写为`~0`和`~1`；根值使用空字符串。源数组序号从`0`开始。
6. 任务参数为`-`时，命令从stdin读取上游的`resultFile`并取得任务路径。例如：

   ```sh
   node scripts/convert.mjs begin "<源卡绝对路径>" | node scripts/convert.mjs extract - /data/description
   ```

## 2. 转换命令

### `begin`：写入确定性内容并提供待判断原文

1. 转换Agent按[Skill入口第1.1节](../SKILL.md#11-调用-begin)调用本命令。脚本识别受支持的源封装，检查已有字段及其成员的类型，通过后创建转换任务，处理人物字段、世界书条目和正则，将需要判断用途或目标映射的内容保存为待判断事项。源字段可以缺失；转换Agent禁止为满足源交换格式而补写源文件或待判断原文。
2. `data`提供`taskFile`、`packageDirectory`、`workFile`和`pendingCount`。待判断索引及原文的读取方法见[Skill入口第1.2节](../SKILL.md#12-读取待判断内容)。
3. 需要支持创建重试时，转换Agent在首次调用前生成UUID，并通过`--request-id "<UUID>"`传入；重试时沿用该UUID及输入路径。用户更换转换输入后使用新ID。

### `extract`：补读关联源字段

1. 待判断事项引用了未提供的源内容时，Agent将所需JSON Pointer一次传入：

   ```sh
   node scripts/convert.mjs extract "<taskFile>" "<Pointer1>" "<Pointer2>"
   ```

2. `data.items[]`提供各值的`pointer`、`contentFile`和适用的分片路径。不同调用分别保存文件，可以并发提取。正文的读取方法见第1章第3项。
3. 无效Pointer进入`data.issues`，成功成员的内容文件保留。Agent修正失败成员的Pointer后只补读这些成员。

### `map-entry`：写入选择保留的世界书条目

1. Agent决定保留整个条目时，传入条目Pointer和目标文件：

   ```sh
   node scripts/convert.mjs map-entry "<taskFile>" "<条目Pointer>" "worldbooks/book-0/entries/e<源序号>.json" --copy-content
   ```

2. Agent一次保留多个条目时，传入数组Pointer、目标目录和全部所选序号：

   ```sh
   node scripts/convert.mjs map-entry "<taskFile>" "<条目数组Pointer>" "worldbooks/book-0/entries" --indices "<序号1,序号2>" --copy-content
   ```

3. Agent拆分正文时省略`--copy-content`，再按已选择的目标文件写入原文段落。脚本维护条目配置、书内文件列表及人物文件中的书路径；UID规则见[世界书参考第2章](worldbook-fields.md#2-条目身份触发与注入)。
4. `file`提供写入文件路径，批量调用的`results`提供各成员结果；`remaining`列出本命令未映射的源字段，处理方法见[Skill入口第3.2节](../SKILL.md#32-写入文字和状态内容)。

### `map-regex`：合并选择保留的正则

1. Agent判断同一正则数组的全部待判断规则后，一次提交继续作为正则的源序号：

   ```sh
   node scripts/convert.mjs map-regex "<taskFile>" "<正则数组Pointer>" "regex/source.json" --indices "<序号1,序号2>"
   ```

2. 脚本保留begin已写入的规则，合并本次选择并按源顺序写入。空序号字符串表示本次不保留待判断规则。重复调用相同选择不会增加重复规则。
3. `data.file`指向目标文件；`remaining`列出未映射源字段，`issues`列出字段错误。转换处理见[Skill入口第3.2节](../SKILL.md#32-写入文字和状态内容)。需要关联原文时，Agent调用`extract`。

### `copy`：原样写入源内容

1. Agent已确定源位置和目标文件时调用：

   ```sh
   node scripts/convert.mjs copy "<taskFile>" "<源Pointer>" "<目标文件>" [--target-pointer "<目标Pointer>"]
   ```

2. 不带`--target-pointer`时，脚本替换整个文件；字符串写为UTF-8原文，其他值写为JSON。指定目标Pointer时，脚本保留同一JSON中的其他字段。
3. 同一JSON需要多个字段修改时，Agent合并为一次调用：

   ```sh
   node scripts/convert.mjs copy "<taskFile>" "<目标文件>" --field "<源Pointer1>" "<目标Pointer1>" --field "<源Pointer2>" "<目标Pointer2>"
   ```

4. 复制字符串片段时添加`--start`或`--end`；省略的起点为`0`，省略的终点为源字符串长度。位置采用JavaScript UTF-16索引，包含起点、不包含终点。
5. `data.file`指向写入文件。批量任一项失败时，目标文件保持原样；Agent修正输入后重试整次调用。

### `parse`：将源字符串中的JSON或YAML写为JSON

1. Agent判断源字符串为数据并选择目标文件后调用：

   ```sh
   node scripts/convert.mjs parse "<taskFile>" "<源Pointer>" "<目标JSON>" --format yaml [--target-pointer "<目标Pointer>"]
   ```

2. 多字段和片段参数采用本章`copy`的用法。脚本将解析结果写入目标文件，`data.file`指向该文件；解析失败时，Agent核对所选源范围及格式。

3. 转换Agent需要将已选定的静态replace数组应用到基础初值时调用：

   ```sh
   node scripts/convert.mjs parse "<taskFile>" "<源Pointer>" \
     "<目标初值JSON>" --format json \
     --start <起点> --end <终点> --apply-replacements
   ```

4. `--apply-replacements`是可选布尔开关，默认关闭；本模式的`--format`须为`json`。同一调用中，`--apply-replacements`与`--target-pointer`、`--field`互斥。其他参数按本章`copy`和`parse`的已有定义传入。

### `state-source`：读取源静态字段

1. 转换Agent在任务目录填写请求JSON，提供源字符串的`sourcePointer`和Zod声明的`symbol`，然后调用：

   ```sh
   node scripts/convert.mjs state-source "<taskFile>" "<请求JSON路径>"
   ```

2. 转换Agent读取返回的`fields`和`unresolved`，按源位置阅读属性声明、动态结构及源操作，按[状态定义步骤](../SKILL.md#322-提交状态定义与开场初值)确定字段对应和处理依据。

### `state-schema`：提交状态定义

1. 转换Agent先调用`node scripts/convert.mjs state-schema --help`，按返回的请求schema填写`schema`；已读取源字段清单时，同时填写`coverage`中的字段对应及处理依据。
2. 转换Agent调用：

   ```sh
   node scripts/convert.mjs state-schema "<taskFile>" "<请求JSON路径>"
   ```

3. 转换Agent读取状态定义校验和源字段覆盖结果，按[状态调整步骤](../SKILL.md#323-选择权限与调整状态定义)处理已有定义的变更。

### `state-initial`：提交开场初值

1. 状态定义提交成功后，转换Agent在请求JSON的`value`中填写对应开场的完整初值，调用：

   ```sh
   node scripts/convert.mjs state-initial "<taskFile>" "<openingId>" "<请求JSON路径>"
   ```

2. 转换Agent读取保存结果；校验失败时，按第3章读取诊断，核对源字段约束和开场取值，再提交修正数据。

### `state-fields`：列出状态字段

1. 转换Agent调用以下命令，读取字段引用、类型和嵌套关系：

   ```sh
   node scripts/convert.mjs state-fields "<taskFile>"
   ```

### `state-permissions`：提交字段权限

1. 转换Agent在请求JSON的`permissions`中提交字段引用与写入许可，需要设置状态更新配置时同时填写`profile`。完整字段及约束通过`node scripts/convert.mjs state-permissions --help`取得。
2. 转换Agent调用：

   ```sh
   node scripts/convert.mjs state-permissions "<taskFile>" "<请求JSON路径>"
   ```

3. 转换Agent读取权限保存和配置校验结果。

### `state-paths`：生成可写路径

1. 转换Agent调用：

   ```sh
   node scripts/convert.mjs state-paths "<taskFile>"
   ```

2. 转换Agent读取`writablePaths`及保存结果，核对写入许可与源更新规则。命令报告无法确定的结构时，转换Agent读取对应schema位置，按源含义调整状态定义或权限选择后重新提交。

### `bind-page-macros`：生成页面宏绑定

1. 转换 Agent 完成页面 HTML、前端入口和前端 manifest 后，将包含源宏的文字登记为绑定请求。先调用 `node scripts/convert.mjs bind-page-macros --help`，读取当前支持项、用途条件和输入 schema。
2. 转换 Agent 在任务目录写入请求 JSON，字段如下：

   | 字段                                | 转换 Agent 提交的内容                                     |
   | ----------------------------------- | --------------------------------------------------------- |
   | `id`                                | 本页面文字绑定的唯一标识；重复执行同一绑定沿用该值        |
   | `source.pointer`                    | 源 HTML 所在字符串的 JSON Pointer                         |
   | `source.start`、`source.end`        | 原始模板在源字符串中的 UTF-16 区间，索引定义见本章 `copy` |
   | `htmlFile`                          | 包内目标 HTML 文件路径                                    |
   | `template`                          | 所选区间的原始文字，保留源宏                              |
   | `location.before`、`location.after` | 可选的目标文字前后文，用于确定 HTML 内的唯一位置          |
   | `conditions`                        | 源文字用途及数据对应，按下一项填写                        |
   | `stateSchemaFile`                   | 变量绑定所用的包内状态 schema 路径                        |

3. 固定角色资料用途填写 `conditions.card: "package-card"`；明确为单角色会话的用途填写 `conditions.session: "single-character"`。源 local 变量的全部写入已迁入角色状态时，转换 Agent 在 `conditions.variables` 中将源变量名对应到状态字段路径数组。页面文字需要读取当前分支中已保存且可见的消息的活动页正文时，填写 `conditions.messages: "saved-visible-active"`。转换 Agent 禁止用这些用途选择替代源行为所需的会话覆盖资料、群组状态或其他存储作用域。
4. 转换 Agent 调用以下命令：

   ```sh
   node scripts/convert.mjs bind-page-macros "<taskFile>" "<请求JSON路径>"
   ```

5. 命令校验源区间、目标文字位置、宏用途及状态字段，生成文字节点、绑定模块、公共模块和入口调用，并登记固定角色资料。转换 Agent 按第1章读取结果，随后返回[页面转换步骤](../SKILL.md#33-改写-htmlcss-和程序)。
6. 目标位置匹配不到、匹配多处、宏名未知、用途条件缺失或资料循环引用时，转换 Agent 按第 3 章读取诊断。诊断指出宿主能力缺口时，转换 Agent 保存宏名、源位置及所需行为，并按[入口第5.2节](../SKILL.md#52-能力缺口)处理。普通花括号文字保留为普通文本。

### `index`：登记已完成的包文件

1. Agent等待全部文件写入完成后调用：

   ```sh
   node scripts/convert.mjs index "<taskFile>" [--frontend "frontend/manifest.json"]
   ```

2. 启用角色前端时添加`--frontend`。`data.file`指向生成的manifest；Agent按`issues`修正文件及引用问题后重新调用。

### `validate`：检查包格式、引用与模块

1. Agent完成manifest后调用：

   ```sh
   node scripts/convert.mjs validate "<taskFile>"
   ```

2. 转换Agent按[Skill入口第4.1节](../SKILL.md#41-检查和打包)修复诊断。

### `pack`：生成独立交付ZIP

1. 包检查通过后，Agent调用：

   ```sh
   node scripts/convert.mjs pack "<taskFile>"
   ```

2. `data.archive`是已通过实际ZIP校验的独立归档路径，Agent交付该路径。

## 3. 失败与写入顺序

1. Agent读取`diagnosticFile`中的错误、位置及修正动作。begin报告源格式错误、版本不支持、输入不存在、无法读取或无法解析时，Agent结束当前卡的转换，向用户报告源路径和实际诊断；源格式诊断同时报告声明版本及issues中的字段位置、期望约束和实际类型。禁止修正源文件或继续当前卡的映射、目标补写和打包。
2. 参数或本次产物错误时，Agent修正后重试；其他错误无法修正时，Agent停止并报告失败命令及诊断。
3. 世界书批量写入失败时，Agent检查`results`中的失败成员，修正后用`--indices`指定这些成员重试。
4. 状态写入与页面宏绑定可以从同一输入任务并发生成独立结果；调用期间，转换Agent保持输入任务及请求文件不变。转换Agent逐次完成其他文件写入；同一书的多个条目采用`map-entry --indices`一次提交。
5. `index`、`validate`和`pack`运行期间，Agent保持包文件不变。
