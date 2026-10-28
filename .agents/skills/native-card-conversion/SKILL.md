---
name: native-card-conversion
description: 将用户指定的单个 SillyTavern PNG 或 JSON 角色卡转换为 TavernHeadless 原生 ZIP。识别字段、世界书、正则及插件的用途，将有效内容写入原生文件，完成包检查和打包。
---

<!-- markdownlint-disable MD013 MD033 -->

# 原生角色卡转换

1. 转换 Agent 将用户指定的单个 PNG 或 JSON 角色卡文件转换为原生角色包，保留人物与剧情事实、初值、变量变化规则、计算和交互功能。

## 转换最高原则：原文承接

1. 转换 Agent 将源卡中仍有效的文字原样写入目标文件；与目标系统冲突的格式标签按[显示标签适配](references/semantic-experience.md#21-显示标签适配)改写。
2. 转换 Agent 保留源 HTML 和 CSS；当前前端 API 要求调整挂载结构或样式作用域时，转换 Agent 仅修改这些必要部分。
3. 转换 Agent 按当前正式模块 API 转写程序代码，保持输入、条件、分支、执行顺序、状态来源和结果。

## 文件读写范围

1. 转换内容仅取自用户指定的单个角色卡文件及本次 `begin` 提供的待判断原文，两者均保持只读。转换 Agent 检查转换产物时，只读取本次任务的产物，禁止读取或复制其他角色卡、旧试产目录和其他任务的转换结果。
2. 转换 Agent 将本 Skill 及[资料来源第1、2章](references/sources.md#1-适用版本与正式来源)列出的 API、schema 和实现入口作为只读参考。
3. 转换 Agent 使用本次转换命令返回的任务路径，按[转换工具第1章](references/tools.md#1-调用入口与结果读取)确定写入位置。
4. 转换 Agent 的交付目标是 ZIP；应用源码、运行配置、环境变量、依赖和服务权限均保持原状。转换 Agent 的运行检查限于第4章的包检查与打包。

## 1. 调用预检并读取结果

### 1.1. 调用 begin

1. 转换 Agent 在本 Skill 目录执行以下命令，传入用户指定的单个角色卡文件：

   ```sh
   node scripts/convert.mjs begin "<源角色卡 PNG 或 JSON 文件的绝对路径>"
   ```

2. 转换 Agent 先读取命令退出状态：成功时进入第1.2节；失败时按[转换工具第3章](references/tools.md#3-失败与写入顺序)读取诊断并处理当前卡。

### 1.2. 读取待判断内容

1. 转换 Agent 按[转换工具第1章](references/tools.md#1-调用入口与结果读取)读取结果文件，取得 `taskFile`、`packageDirectory`、`workFile` 和 `pendingCount`。
2. `pendingCount` 为 `0` 时，转换 Agent 进入第3.1节。
3. `pendingCount` 大于 `0` 时，转换 Agent 读取 `workFile`。索引直接含 `items` 时逐项阅读；索引提供 `partsDirectory` 时按编号顺序阅读该目录的全部分片。
4. 转换 Agent 阅读每项的 `pointer`、`question` 和原文文件 `contentFile`。该项提供 `contexts` 时，转换 Agent 读取其中各关联原文文件。原文提供分片时，按[转换工具第1章](references/tools.md#1-调用入口与结果读取)读取全部分片。

## 2. 判断源内容的用途和转换方式

### 2.1. 理解两套架构

1. 转换 Agent 阅读[源架构与目标架构第1、2章](references/architecture.md)，区分源环境的字段、插件和脚本职责与目标系统的文件和运行职责。

### 2.2. 识别字段内容的用途

1. 转换 Agent 以待判断事项为入口，按[角色字段参考第1至3章](references/character-fields.md)阅读人物文字和开场。转换 Agent 根据引用关系读取相关的已复制字段。
2. 源卡含世界书或条目引用时，转换 Agent 按[世界书参考第1至6章](references/worldbook-fields.md)，检查条目正文、触发条件和引用关系。
3. 源卡含正则、助手、MVU 或其他插件内容时，转换 Agent 按[扩展字段参考第1至3章](references/extension-fields.md)，检查匹配对象、替换内容、脚本入口和执行条件。
4. 转换 Agent 从这些内容中识别人物事实、初始化内容、变量规则、公式、页面和操作入口。名称、变量、数值、条件、公式和资源均取自当前源卡。

5. 转换 Agent 按第5.1节判断整卡是否属于排除项。

### 2.3. 决定保留、拆分、转写或删除

1. 转换 Agent 按[语义判定经验第1至6章](references/semantic-experience.md)，为每部分内容确定处理动作及目标职责。
2. 同一字段包含多种职责时，转换 Agent 逐句阅读用途和生效条件，为各原文片段选择目标职责。关键词用于定位阅读位置，保留和删除由转换 Agent 阅读决定。多个字段共同实现一个功能时，按源引用关系保留参与实现的内容。转换 Agent 按[语义判定经验第6章](references/semantic-experience.md#6-删除与改写的判断)处理重复内容。
3. 内容涉及计算或工具调用时，转换 Agent 按[语义判定经验第4章](references/semantic-experience.md#4-计算与工具调用)判断执行主体与时点，并按[目标架构第2.6节](references/architecture.md#26-正文模型的工具调用)选择正式定义的系统工具及其结果读取方式；所需能力没有可用接口时，按第5.2节处理。

### 2.4. 外置正文缺失时停止转换

1. 决定保留的功能需要外置世界书或脚本，而源卡只提供名称、路径或 URL，未包含正文时，转换 Agent 停止本次转换，报告引用字段的 JSON Pointer、引用值和缺少的正文。

## 3. 按判断生成原生文件

### 3.1. 选择文件、格式和接口

1. 转换 Agent 按[目标文件与格式第1至3章](references/conversion-map.md)，为第2章的处理决定选择目标目录、文件、字段和读取该内容的模块。
2. 内容涉及前端、后端或工具调用时，转换 Agent 按[资料来源第3章](references/sources.md#3-转换-agent-何时读取-api-资料)阅读对应的内置 API 文档。
3. 转换 Agent 配置状态更新时，依据[后端 API 第3、4章](references/api/backend-api.md)确定配置字段和状态输出格式，依据[状态提示词组装](references/api/state-prompt-assembly.md)选择规则文件或世界书节点的读取方式，再按[状态更新 profile schema](references/api/state-update-profile.schema.json)填写第3.2.3节的配置提交数据。

### 3.2. 写入文字和状态内容

#### 3.2.1. 写入文字、世界书和正则

1. 转换 Agent 按第2章的判断补写人物文字、世界书和正则，每次调用后按[转换工具第3章](references/tools.md#3-失败与写入顺序)读取结果。已复制字段与第2章的判断冲突时，转换 Agent 按该判断调整对应目标字段。
2. 转换 Agent 为保留的世界书条目调用[map-entry](references/tools.md#map-entry写入选择保留的世界书条目)，条目正文采用第2章确定的写入方式。返回未映射内容时，转换 Agent 按第2.3节决定处理动作，再按第3.1节选择写入位置。
3. 转换 Agent 为继续作为文本正则的规则调用[map-regex](references/tools.md#map-regex合并选择保留的正则)，按字段诊断修正目标正则，按第2.3节处理未映射内容。
4. 转换 Agent 使用[copy](references/tools.md#copy原样写入源内容)写入选定原文，直接编辑前端模块、后端模块及其调用配置。转换 Agent 禁止编写或运行临时生成器、迁移程序。

#### 3.2.2. 提交状态定义与开场初值

1. 源卡具有有效状态初始化或更新行为时，转换 Agent 阅读源字段声明、各开场取值、默认值、计算规则和更新规则。源卡使用MVU时，转换 Agent 按[扩展字段参考第3章](references/extension-fields.md#3-mvu-初始化消费)确定各开场的初值来源。
2. 源卡包含Zod字段声明时，转换 Agent 按[状态源字段清单](references/tools.md#state-source读取源静态字段)提交源JSON Pointer和Schema符号，逐项阅读返回的字段及源位置，为每个字段确定目标字段或用途变化的依据。脚本列出动态结构或源操作时，转换 Agent 读取对应原文并记录处理决定。
3. 转换 Agent 按[状态定义提交](references/tools.md#state-schema提交状态定义)提交字段结构、类型、取值约束及源字段对应关系，读取命令结果。提交成功后，转换 Agent 进入下一项。
4. 转换 Agent 按[开场初值提交](references/tools.md#state-initial提交开场初值)提供开场标识和字段取值，将源默认值及已确定的静态replace操作落实到对应初值。转换 Agent 按[快照第3.1节](references/api/script-api.md#31-snapshot会话初始或某轮回复后的角色变量记录)核对初值字符串的宿主展开结果。
5. 提交失败时，转换 Agent 读取诊断中的字段位置和约束，对照源卡确定需要修正的字段定义或取值，再提交修正数据并读取结果。

#### 3.2.3. 选择权限与调整状态定义

1. 转换 Agent 按[状态字段枚举](references/tools.md#state-fields列出状态字段)阅读字段引用、类型和嵌套关系，依据源更新规则选择模型允许修改的字段及计算模块维护的字段。
2. 转换 Agent 按[状态权限提交](references/tools.md#state-permissions提交字段权限)提交权限选择和状态更新配置，再按[可写路径生成](references/tools.md#state-paths生成可写路径)读取派生结果。
3. 转换 Agent 调整字段定义时，在状态定义提交中一并提供受影响的开场取值和权限选择，读取整组提交的校验结果。
4. 转换 Agent 核对每个源字段的含义、各开场值、写入权限、计算规则和业务校验，保存处理依据后继续执行第3.3节。

### 3.3. 改写 HTML、CSS 和程序

1. 源卡没有页面时，转换 Agent 创建包含[系统聊天组件](references/api/script-api.md#111-apiwidgetsmountchat--挂载系统聊天组件)的最小前端，提供消息输入与正文显示。
2. 转换 Agent 按[当前前端 API](references/api/script-api.md)和[前端入口格式](references/api/script-template-api.md)调整 HTML 挂载、CSS 作用域、模块入口及资源引用。
3. 页面文字包含源宏时，转换 Agent 识别其文字用途和源位置，按[页面宏绑定](references/tools.md#bind-page-macros生成页面宏绑定)提交原始模板及用途选择。转换 Agent 禁止手写宏公共模块、绑定模块和入口调用。
4. 转换 Agent 按[当前后端 API](references/api/backend-api.md)实现具名导出、导入格式、上下文参数和允许的全局对象，转写状态读取、资源访问及计算方法。
5. 源卡包含消息发送时，转换 Agent 按[语义判定经验第2章](references/semantic-experience.md#2-正则页面与显示)实现发送锁和恢复操作。

### 3.4. 保存媒体和引用

1. 源卡包含媒体数据时，转换 Agent 按[目标文件与格式第1章](references/conversion-map.md#1-包目录与命名)将媒体文件保存到包内 assets 目录，并使用包内路径引用。
2. 图片或音频已有外链 URL 时，转换 Agent 原样保存 URL。
3. 源卡只提供资源名或本地路径而没有资源数据时，转换 Agent 省略该资源的包文件登记，在页面对应位置显示资源缺失说明，并按第4.2节说明缺失资源。

### 3.5. 登记包文件

1. 转换 Agent 调用[转换工具第2章的 index](references/tools.md#index登记已完成的包文件)，生成根 manifest，处理返回的文件和引用问题。

## 4. 检查包文件并交付 ZIP

### 4.1. 检查和打包

1. 转换 Agent 调用[转换工具的 validate](references/tools.md#validate检查包格式引用与模块)，核对包格式、文件引用和当前模块契约。
2. 转换 Agent 按 `issues` 中的文件、位置和问题修复对应产物，再调用 `index` 和 `validate`。修改关联文件前，转换 Agent 核对该文件与诊断对象的引用关系，再修改受影响字段或代码。模块语法或 API 调用诊断只修复对应代码；确需改变原文选择时，转换 Agent 返回第2.3节重新阅读源文。
3. 检查通过后，转换 Agent 调用[转换工具的 pack](references/tools.md#pack生成独立交付zip)，取得本次 ZIP 的 `archive` 路径。

### 4.2. 交付结果

1. 转换 Agent 返回 `archive` 路径和包检查结果。
2. 存在缺失的图片或音频时，转换 Agent 列出其源字段、资源名或路径，以及页面显示的缺失说明。

## 5. 排除项与能力缺口

### 5.1. 整卡排除

1. 源卡包含内置手机插件的独立对话生成与历史保存，或包含同时恢复剧情位置和完整变量的存档逻辑时，转换 Agent 跳过整卡，报告对应源功能与位置。
2. 源卡仅含手机样式展示或历史状态回看时，转换 Agent 继续转换。

### 5.2. 能力缺口

1. 转换 Agent 先核对源功能的输入、输出和执行时序；页面功能按[页面配置与交互生命周期](references/semantic-experience.md#22-页面配置与交互生命周期)核对现有接口的组合实现。现有 API 无法实现需要保留的行为时，转换 Agent 停止本次转换，向用户报告源字段的 JSON Pointer、所需行为、已查阅的接口，以及接口缺少的输入、输出或执行时序。
