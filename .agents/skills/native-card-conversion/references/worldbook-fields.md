---
文档用途: 解释源世界书字段及目标系统对应的处理方式。
读取时机: 转换 Agent 判断源卡中的世界书内容和条目引用时。
---

<!-- markdownlint-disable MD013 MD033 -->

# 世界书字段的用途与处理

1. 转换 Agent 根据[固定版本世界书实现](https://github.com/SillyTavern/SillyTavern/blob/51ad27fb86d39a3daca3adaa970375c9670c12df/public/scripts/world-info.js)中的 `convertCharacterBook`、`newWorldInfoEntryDefinition`、`world_info_position`、`world_info_logic` 和激活流程核对源字段及映射。目标结构及世界书触发、组装行为按[只读实现入口](sources.md#2-只读实现依据)核对。

2. 表中的斜线表示源格式可能使用的字段位置或别名；Agent 以本次格式的实际消费顺序解释冲突。

## 1. 书级设置与内容职责

1. 适用版本见[适用版本与来源](sources.md#1-适用版本与正式来源)，字段判定动作见[角色字段第1章](character-fields.md#1-格式与字段判断)。转换 Agent 读取角色卡 JSON 内的 `character_book`，按实际成员定位条目数组或按 ID 保存的条目对象。

   | 源字段                             | 源用途                           | 原生处理依据                                                                        |
   | ---------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
   | `name`、`description`              | 世界书名称与说明                 | 原生书名及资料；说明含有效规则时按内容职责处理                                      |
   | `entries`                          | 世界书条目容器                   | 按成员内容决定保留条目、拆分功能或删除；原生书用 `entryFiles` 引用条目文件          |
   | `scan_depth` / `scanDepth`         | 最近消息的扫描范围               | 原生书 `scanDepth`；检查条目覆盖及实际扫描来源                                      |
   | `recursive_scanning` / `recursive` | 已激活条目内容可继续触发其他条目 | 原生 `recursive`，对照条目的递归设置                                            |
   | `maxRecursionSteps`                | 运行环境的递归次数限制           | 原生书同名字段，按源功能选择明确边界                                                |
   | `caseSensitive`、`matchWholeWords` | 书级匹配默认值                   | 原生书同名字段；条目可按 schema 覆盖                                                |
   | `token_budget`                     | 书级内容预算                     | 核对源预算优先级与目标预设预算；目标书 schema 的 `extra` 存储与实际预算消费分别确认 |
   | `extensions`                       | 平台或插件的书级自定义数据       | 阅读实际成员及其源读取者，核对目标读取者后决定处理方式；条目扩展见第4章              |

2. `extensions.world` 的定义见[角色字段参考第3章](character-fields.md#3-元数据与资源)。Agent 在内嵌条目中解析源提示和脚本引用的名称或 ID；缺失内容按[入口第2.4节的缺失内容处理](../SKILL.md#24-记录转换决定与缺失内容)处理。

3. `content` 是条目的主要内容。Agent 阅读其中的人物事实、叙事要求、初始化、变量规则、条件模板、HTML 和脚本，按照[两套架构](architecture.md)选择原生职责。同一条目可以产生世界书内容、状态规则、后端模块和前端文件。变量相关内容按[独立状态 Agent](architecture.md#22-初始状态与独立状态-agent)迁移。

4. 源控制器通过名称或 ID 显式读取条目时，禁用提示扫描不关闭这个读取入口。Agent 保留这些引用所需的正文与标识，按目标消费者将其保存为世界书或结构化资料，并同步模块引用。结构化资料可以合并保存多条显式引用的内容，保留来源 ID 和模块查找关系；按正式包规则核对全部模块与资料文件的数量和大小。

## 2. 条目身份、触发与注入

1. | 源字段                                                           | 源用途                     | 原生处理依据                                                                          |
   | ---------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
   | `id` / `uid`                                                     | 条目标识                   | 原生 `uid` 要求非负整数；重建标识时同步更新所有条目引用                               |
   | `name`、`comment`                                                | 条目名称及编辑器说明       | 原生 `comment` 或资料；根据实际引用判断是否参与运行                                   |
   | `keys` / `key`                                                   | 主触发词，通常至少一个命中 | 原生 `key`；检查匹配范围、宏和正则含义                                                |
   | `secondary_keys` / `keysecondary`                                | 次级触发词                 | 原生 `keysecondary`，与 `selective` 和逻辑共同确定目标配置                                    |
   | `selective`                                                      | 启用次级匹配条件           | 原生同名字段                                                                          |
   | `extensions.selectiveLogic` / `selectiveLogic`                   | 次级匹配逻辑               | 原生枚举 `0` AND_ANY、`1` NOT_ALL、`2` NOT_ANY、`3` AND_ALL；按本章第2项解释各逻辑     |
   | `constant`                                                       | 常驻激活，仍受其他筛选约束 | 原生同名字段；保留适用概率、组与生成类型条件                                          |
   | `enabled` / `disable`                                            | 启用状态，两个字段意义相反 | 原生 `disable`；禁用内容按本次必要性保留为禁用或退出运行流程                          |
   | `use_regex`                                                      | 按源格式解释关键词正则     | 检查实际关键词及消费者；目标运行以匹配器支持的表达形式实现                            |
   | `case_sensitive` / `extensions.case_sensitive` / `caseSensitive` | 条目大小写规则             | 原生 `caseSensitive` 可为 null，表示使用书级默认值                                    |
   | `extensions.match_whole_words` / `matchWholeWords`               | 条目整词匹配规则           | 原生 `matchWholeWords`，核对语言和词边界                                              |
   | `extensions.scan_depth` / `scanDepth`                            | 条目扫描范围覆盖           | 原生 `scanDepth`，null 表示使用书级设置                                               |
   | `insertion_order` / `order`                                      | 激活排序及注入顺序         | 原生 `order`；结合其他条目确定排序配置                                                |
   | `position`、`extensions.position`                                | 相对人物或历史的注入位置   | 原生数字位置；源内嵌格式优先读取有效的扩展位置，否则解释 `before_char` / `after_char` |
   | `extensions.depth` / `depth`                                     | 历史内注入深度             | 原生 `depth`；按所选位置确定目标配置                                                  |
   | `extensions.role` / `role`                                       | 注入消息角色               | 原生 `0` system、`1` user、`2` assistant                                              |
   | `extensions.outlet_name` / `outletName`                          | 指定命名出口               | 原生 `outletName`，核对位置 `7` 及模块引用                                      |

2. 位置枚举为：`0` 人物前、`1` 人物后、`2` 作者注释顶端、`3` 作者注释底端、`4` 历史指定深度、`5` 示例前、`6` 示例后、`7` 命名出口。保存枚举后，Agent 使用实际预设和 dry-run 检查条目是否进入预期消息。次级逻辑中 AND_ANY 要求至少一个次级词命中，NOT_ALL 要求至少一个未命中，NOT_ANY 要求全部未命中，AND_ALL 要求全部命中。

## 3. 扫描来源、递归与预算

1. | 源字段                                                     | 源用途                         | 原生运行位置                                                                |
   | ---------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
   | `extensions.match_persona_description`                     | 把用户人设描述加入扫描         | `extra.extensions.match_persona_description`                                |
   | `extensions.match_character_description`                   | 把人物描述加入扫描             | `extra.extensions.match_character_description`                              |
   | `extensions.match_character_personality`                   | 把人物性格加入扫描             | `extra.extensions.match_character_personality`                              |
   | `extensions.match_character_depth_prompt`                  | 把深度提示加入扫描             | `extra.extensions.match_character_depth_prompt`；目标扫描文本来源见本章说明 |
   | `extensions.match_scenario`                                | 把场景资料加入扫描             | `extra.extensions.match_scenario`                                           |
   | `extensions.match_creator_notes`                           | 把作者说明加入扫描             | `extra.extensions.match_creator_notes`                                      |
   | `extensions.exclude_recursion` / `excludeRecursion`        | 本条目内容退出后续递归扫描来源 | 原生 `excludeRecursion`                                                     |
   | `extensions.prevent_recursion` / `preventRecursion`        | 在递归阶段排除本条目           | 原生 `preventRecursion`                                                     |
   | `extensions.delay_until_recursion` / `delayUntilRecursion` | 延迟至指定递归阶段参与         | 原生 `delayUntilRecursion`；按源格式的布尔或整数语义生成目标整数值          |
   | `extensions.ignore_budget` / `ignoreBudget`                | 本条目绕过内容预算裁剪         | 原生实际读取 `extra.extensions.ignore_budget`                               |

2. 原生扫描器当前将人物的 `postHistoryInstructions` 作为 character-depth-prompt 扫描来源；作者说明在明确启用相应扫描设置时参与扫描。

3. Agent 按源行为测试边界、扫描文本及递归链，并阅读运行追踪中的命中来源。带有不同拼写的字段，先核对源消费者，再写入目标实际读取的位置。

## 4. 运行扩展

1. 下表中目标实际消费的扩展键保存在条目的 `extra.extensions` 中。

   | 源字段                                             | 源用途                           | 原生处理依据                                                           |
   | -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
   | `extensions.probability` / `probability`           | 激活概率，百分比范围 0–100       | 扩展 `probability`；对照源候选的概率筛选条件                         |
   | `extensions.useProbability` / `useProbability`     | 使用概率筛选的开关               | 扩展 `useProbability`；false 表示跳过概率筛选                          |
   | `extensions.group` / `group`                       | 互斥组名称，可含多个逗号分隔组   | 扩展 `group`；目标引擎跨书选择组候选                                   |
   | `extensions.group_override` / `groupOverride`      | 优先选择组内覆盖候选             | 扩展 `group_override`，核对候选排序                                    |
   | `extensions.group_weight` / `groupWeight`          | 组内随机选择权重                 | 扩展 `group_weight`，核对零权重与边界                                  |
   | `extensions.triggers` / `triggers`                 | 限定生成类型                     | 扩展 `triggers` 按[条目激活与筛选条件](api/http/worldbooks.md#条目激活与筛选条件)填写 |
   | `extensions.delay` / `delay`                       | 初始消息数量不足时延迟条目       | 扩展 `delay`；目标当前按扫描上下文消息数量检查                         |
   | `extensions.use_group_scoring` / `useGroupScoring` | 源环境按关键词命中得分影响组选择 | 转换Agent按[原生世界书与提示控制器](architecture.md#24-原生世界书与提示控制器)实现有效选择规则，按[能力缺口](../SKILL.md#52-能力缺口)处理缺少的接口 |
   | `extensions.sticky` / `sticky`                     | 激活后持续若干轮                 | 转换Agent按[原生世界书与提示控制器](architecture.md#24-原生世界书与提示控制器)实现持续状态，按[能力缺口](../SKILL.md#52-能力缺口)处理缺少的接口 |
   | `extensions.cooldown` / `cooldown`                 | 激活后的冷却轮数                 | 转换Agent按[原生世界书与提示控制器](architecture.md#24-原生世界书与提示控制器)实现冷却状态，按[能力缺口](../SKILL.md#52-能力缺口)处理缺少的接口 |
   | `extensions.vectorized` / `vectorized`             | 源环境向量检索激活方式           | 取得相关源检索规则后判断有效内容及目标实现                             |
   | `extensions.automation_id` / `automationId`        | 与自动化功能关联的标识           | 定位关联动作、参数和执行阶段，再选择目标工具或模块                     |
   | `characterFilter` 及人物筛选成员                   | 按角色名称、标签及排除条件筛选   | 检查源实际筛选入口和本次目标会话，再选择有效条件实现                   |

2. 目标引擎先选择组候选，再执行概率筛选。Agent 按本次源功能判断顺序差异是否影响结果。静态字段未消费的行为，按[原生世界书与提示控制器](architecture.md#24-原生世界书与提示控制器)检查组合实现。

3. `map-entry` 的配置筛选入口为 [mapEntryWithUids](../scripts/write-mapping.ts)，字段配置由 [entryInactiveExtensions](../scripts/write-config.ts)提供。转换 Agent 根据返回的 `remaining` 阅读对应源内容，确定目标实现。

## 5. 编辑信息与非标准字段

1. `display_index` / `displayIndex` 表示编辑器显示排序，`addMemo` 表示源编辑器的注释显示开关。字段识别配置见 [entryEditorFields](../scripts/write-config.ts)。其他编辑信息由转换 Agent 根据目标编辑与运行需求选择保存或删除。

2. `use_regex` 的用途与判断见第2章；脚本的字段筛选配置见 [entryUnusedFields](../scripts/write-config.ts)。

3. SillyTavern 导入内嵌世界书时，使用下表第二列的字段，第一列扩展只随数据保存。字段识别配置见 [entryUnusedExtensions](../scripts/write-config.ts)。

   | 未消费扩展                        | SillyTavern 实际消费的字段及用途                                        |
   | --------------------------------- | ----------------------------------------------------------------------- |
   | `extensions.secondary_keys_logic` | `extensions.selectiveLogic`                                             |
   | `extensions.weight`               | `extensions.group_weight`                                               |
   | `extensions.cfSortKey`            | `extensions.display_index` 用于编辑排序；`insertion_order` 用于注入顺序 |

4. 其他自定义字段由转换 Agent 根据源规范、实际取值和读取者决定处理方式。

## 6. 重复字段核对

1. 重复字段配置见 [entryDuplicateFields](../scripts/write-config.ts)，处理入口为 [mapEntryWithUids](../scripts/write-mapping.ts)。转换 Agent 阅读 `remaining` 中的源值及其引用，核对对应目标文件，决定处理方式。
