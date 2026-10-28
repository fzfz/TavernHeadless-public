---
文档用途: 说明原生包目录、命名、格式、引用及文件创建责任。
读取时机: 转换 Agent 已确定内容用途，需要选择目标文件并确定引用字段或读取模块时。
---

<!-- markdownlint-disable MD013 -->

# 目标文件与格式

## 1. 包目录与命名

1. 原生包采用以下目录结构。根目录的三份文件必需；其他文件按当前卡的有效功能创建。目录树中 `<...>` 表示由 Agent 确定的名称，带“示例名”的文件可以按同目录规则改名。

   ```text
   package/
   ├── manifest.json                       必需，固定名称：由 index 写入
   ├── character.json                      必需，固定名称：由 begin 复制字段、Agent 补写
   ├── openings.json                       必需，固定名称：由 Agent 写入
   ├── openings/
   │   └── <opening-id>.txt                 Agent 命名
   ├── state/
   │   ├── schema.json                     使用状态时，固定名称：JSON Schema
   │   └── initial/
   │       └── <opening-id>.json            Agent 命名
   ├── worldbooks/
   │   └── <book-id>/                       Agent 确定世界书标识
   │       ├── book.json                   使用该书时，固定名称：条目索引
   │       └── entries/
   │           └── <entry-name>.json       Agent 命名：世界书条目
   ├── agents/
   │   └── state-update/
   │       ├── profile.json                启用状态 Agent 时，固定名称：更新配置
   │       └── <source-rule-id>.txt         Agent 命名
   ├── backend/
   │   ├── controllers/
   │   │   ├── config.json                 启用控制器时，固定名称：控制器配置
   │   │   └── <module-name>.js            Agent 命名
   │   ├── variable-tools/
   │   │   └── <module-name>.js            Agent 命名
   │   └── validators/
   │       └── <module-name>.js            Agent 命名
   ├── frontend/
   │   ├── manifest.json                   启用角色前端时，固定名称：前端入口配置
   │   ├── index.html                      示例名：页面 HTML
   │   ├── style.css                       示例名：页面 CSS
   │   ├── main.js                         示例名：前端模块
   │   └── <floor-template>.html            可选：历史楼层模板
   ├── regex/
   │   └── <profile-name>.json              Agent 命名
   ├── data/
   │   └── <data-name>.json                 Agent 命名
   └── assets/
       └── <resource-path>                  Agent 确定路径：所需媒体文件，可分子目录
   ```

### 1.1 名称与目录的依据

1. 正式包 `1.0.0` 的文件规则规定必需入口、条件入口、允许目录、扩展名及引用范围；正式 schema 定义各文件的字段与约束。两份依据的只读位置见[包格式与文件规则](sources.md#2-只读实现依据)。

2. 固定入口使用上图给出的名称。Agent 为同一目录内的多个开场、条目、规则、模块及资源选择不同名称，保持对应引用一致。转换 Agent 按正式字段定义填写开场 ID、世界书 ID 和条目 UID。条目文件名由 Agent 选择，条目 UID 在同一本书中唯一。

3. 转换 Agent 修改文件名时，更新第2章所列引用中的文件路径，并按正式路径约束填写包内相对路径。

## 2. 内容对应的文件与读取入口

1. | 内容实际作用                             | 文件与格式                                                                         | 字段、入口与引用关系                                                                                                                    |
   | ---------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | 人物身份、性格、剧情背景、示例           | `character.json`，JSON                                                             | `name`、`description`、`personality`、`scenario`、`exampleDialogue` 等；`manifest.json.character` 引用人物文件。                        |
   | 开场剧情或介绍                           | `openings/<id>.txt`，文本；`openings.json`，JSON                                   | `items[].textFile` 引用正文；`id`、`kind`、`audience` 和 `defaultOpeningIds` 定义可用开场。源默认开场正文为空时，转换 Agent 保存空文本文件及默认开场索引项，供会话初始化使用。                                             |
   | 实际初始化值与开场差异                   | `state/initial/<id>.json`，状态对象 JSON                                           | `openings.json.items[].initialStateFile` 引用初始状态；Agent 按源初始化执行顺序推导各开场值。                                           |
   | 变量类型、范围、枚举、必需字段及结构     | `state/schema.json`，JSON Schema                                                   | `type`、`properties`、`required`、`additionalProperties` 及适用约束；状态更新配置的 `stateSchemaFile` 引用。                            |
   | 根据剧情提出变量变化的规则               | `agents/state-update/<source-rule-id>.txt`，UTF-8 源规则原文；`profile.json`，JSON | `ruleFiles` 按路径顺序读取规则全文；`presetRef` 绑定独立状态预设；`updaterPrompt` 是保留的包格式兼容字段，不提供正式状态任务指令；`writablePaths` 定义可写路径；`character.json.stateUpdate` 引用配置。 |
   | 自动派生的公式与状态计算                 | `backend/variable-tools/<name>.js`，ESM JavaScript                                 | 状态更新配置的 `deriveScript` 绑定正式后端计算入口；`derivedPaths` 记录适用派生路径。入口、输入输出按后端 API 核对。                    |
   | JSON Schema 无法完整表达的约束与守卫     | `backend/validators/<name>.js`，ESM JavaScript                                     | 状态更新配置的 `validateScript` 绑定正式校验入口；按源变更、计算、校验顺序核对效果。                                                    |
   | 世界事实、人物资料及仍有效的提示触发     | `worldbooks/<book>/book.json` 与条目 JSON                                          | 人物的 `worldbooks[]` 绑定书；条目的 `content`、关键词、位置、深度、角色和启用字段按正式世界书 schema 保存。                            |
   | 状态分支、模板求值或动态提示生成         | `backend/controllers/<name>.js`，ESM；控制器配置 JSON                              | `character.json.promptController` 引用配置；`modulePath` 绑定模块。Agent 将源宏或模板的实际输入与输出改为正式控制器 API。               |
   | 仍需文本匹配或替换的处理                 | `regex/<name>.json`，正式正则配置 JSON                                             | 人物的 `regexProfiles[]` 绑定配置；匹配式、替换内容、顺序和作用范围按正式 schema 保存。                                                 |
   | 状态显示与必要操作                       | 前端 HTML、CSS、ESM 及前端 manifest JSON                                           | `manifest.json.frontend` 引用前端 manifest；模块按正式前端入口使用状态、历史、聊天和 UI API。                                           |
   | 可调整的计算参数、条件表、图片索引等数据 | `data/<name>.json`，JSON；所需媒体文件                                             | 文件登记和数据引用见[第3章](#3-文件登记与引用)。                                                                                        |

2. 状态条件内容的转换决定见[语义判定经验第3章](semantic-experience.md#3-世界书读取与动态提示)。正式状态规则文件、状态预设和组装输入见[角色变量更新 API](api/state-update-api.md)与[状态提示词组装](api/state-prompt-assembly.md)。
3. `promptController` 只替换 `controllerEntries` 指定条目的正文，并停用 `updaterEntries` 指定条目；该控制器不会启用原生包中已禁用的条目。需要动态生成正文的条目应保持启用，只配置为 `controllerEntries`，并且不同时列入 `updaterEntries`。配置字段见[后端 API 第7、8章](api/backend-api.md#7-promptcontroller配置提示词控制器)。

## 3. 文件登记与引用

1. 转换 Agent 按[入口第3.5节](../SKILL.md#35-登记包文件)执行文件登记，并按正式 schema 核对第2章的引用。
2. 转换 Agent 编写模块代码，使模块按数据文件的字段读取所需值；源插件配置写入 `extra` 时，转换 Agent 按[世界书参考第4章](worldbook-fields.md#4-运行扩展)核对读取该配置的原生模块。
