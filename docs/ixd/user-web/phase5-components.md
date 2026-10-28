---
文档用途: 定义用户 Web 的复用组件、属性与事件约定、设计变量及双端适配方式。
读取时机: 制定视觉方案、制作双端原型或实现用户 Web 组件时读取。
---

# 阶段 5：用户 Web 组件规范

## 1. 组件范围与使用方式

1. 本文从[阶段 4 页面规格](phase4-page-specs/README.md)提取组件，覆盖 P01—P22。页面的任务、文案、资源归属和保存规则仍以各页第 4、7 节为依据；组件的属性、呈现状态及组合方式由本文定义。
2. 目标为桌面与手机浏览器。Vue 页面组合本规范的受控组件，页面控制器负责读取、写入、草稿和导航；组件接收当前数据与状态，通过事件请求操作。本文规定组件契约，当前消费入口见[功能依据第 2 节](feature-basis.md)。
3. 组件分为 U01—U12 基础组件和 D01—D15 业务组件。页面中的 C 编号映射见第 7 节；多个 C 编号可使用同一个组件实例的不同区域。
4. 宿主与角色的职责采用[需求规格第 4 节](user-web-requirements.md)。D10 保留独立会话页面的通用入口，D11 承载角色 Runtime，角色在自己的布局中挂载通用聊天；具体生命周期引用[Runtime 架构](../../character-authoring/runtime-architecture.md)。
5. 组件视觉用法见[阶段 6](phase6-visual.md)。[设计变量配置](phase6-tokens.json)是变量值的唯一维护入口；本文第 3、6.1 节的数值表是供阅读的配置投影，修改配置时同步生成。

## 2. 共用属性、事件与状态

### 2.1 数据约定

1. 下表是组件输入的设计类型。实现者根据实际 SDK 类型映射字段，资源标识和请求状态由页面控制器提供。

| 类型         | 字段与取值                                                                                                                          | 使用要求                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| ResourceKey  | `accountId?`、`resourceId`、`branchId?`                                                                                             | 个人资源必须包含账号；会话分支内容包含分支标识                        |
| ActionSpec   | `id`、`label`、`intent: primary / secondary / text / danger`、`availability: ready / blocked / pending`、`reason?`、`pendingLabel?` | blocked 必须有原因；pending 必须有进度文案；事件返回 actionId         |
| RuntimeState | `idle / loading / ready / failed`                                                                                                   | Runtime 挂载状态；生成与保存进度由独立反馈提供                        |
| ReadState    | `idle / loading / ready / empty / partial / error`                                                                                  | partial 同时提供可读内容与失败区域；empty 表示已确认的空结果          |
| WriteState   | `idle / submitting / verifying / succeeded / failed / partial / unknown`                                                            | 状态由已确认的操作结果驱动；逐项写入可以使用 partial                  |
| FieldSpec    | `id`、`label`、`required`、`hint?`、`error?`、`limit?`                                                                              | limit 来自实际字段契约；错误说明与字段 ID 关联                        |
| CountValue   | `kind: total / loaded / unavailable`、`value?`                                                                                      | total 表示完整查询计数，loaded 表示已加载数；unavailable 使用文字说明 |
| ItemOutcome  | `resourceId`、`status: deleted / missing / failed / unknown`、`reason?`                                                             | 删除结果逐项提供，重试目标由页面控制器确定                            |

2. 每个业务组件的必填数据均无默认资源；省略可选文本时省略对应内容区。事件只表达用户意图，成功状态由页面控制器回传。选择、表单值、展开项和当前候选采用受控值，组件内部保留焦点、悬停、输入法组词以及密码显隐、补充提示显隐状态。
3. Vue 值更新统一使用 `update:modelValue`；操作使用 `activate(actionId)`，资源选择使用 `select(resourceId)`。下文列出的专用事件携带其对应目标标识；目标范围采用 ResourceKey。

### 2.2 控件呈现状态

1. 状态表定义视觉语义，变量在第 3 节登记。焦点可以与选中、错误或运行状态同时呈现；可操作性由 ActionSpec 与字段只读状态决定。

| 状态     | 表面与文字                                                                                                       | 边框及附加反馈                                                  | 事件处理                   |
| -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------- |
| 默认     | 中性表面用 `--color-bg-surface`、正文用 `--color-text-primary`；主操作用 `--color-primary`、`--color-on-primary` | 控件边框用 `--color-border`；内容分隔用 `--color-divider`       | 按具体组件接收操作         |
| 悬停     | 中性控件用 `--color-bg-hover`；主操作用 `--color-primary-hover`                                                  | 保留当前选中、错误及焦点说明                                    | 指针设备可显示 U12 提示    |
| 按下     | 中性控件用 `--color-bg-pressed`；主操作用 `--color-primary-pressed`                                              | 保持尺寸与文字位置                                              | 一次有效激活发出一次事件   |
| 键盘焦点 | 保留原表面与文字                                                                                                 | `--color-focus`、`--border-focus-width`、`--space-focus-offset` | 按组件键盘规则执行         |
| 已选中   | `--color-bg-selected`、`--color-text-primary`                                                                    | `--color-border-selected` 与文字或选择标记                      | 单选、多选分别更新受控值   |
| 不可操作 | `--color-bg-disabled`、`--color-text-disabled`                                                                   | 显示原因并关联说明                                              | 阻止激活，原因仍可读取     |
| 运行中   | 保留原操作层级与文字可读性                                                                                       | 显示 pendingLabel 或 U06 运行反馈                               | 相同操作等待当前结果       |
| 字段错误 | `--color-bg-surface`、原输入正文                                                                                 | `--color-error` 边框及关联错误文本                              | 允许修正符合页面规则的字段 |
| 只读     | 保留正文与普通表面                                                                                               | 使用只读语义，文本可选择                                        | 阅读、复制与独立导航仍可用 |

2. 删除操作的默认、悬停和按下分别使用 `--color-danger`、`--color-danger-hover`、`--color-danger-pressed`，文字使用 `--color-on-danger`；对应状态的键盘焦点仍采用同一焦点变量。
3. 原生按钮的不可操作状态使用 disabled；需要通过键盘读取不可用原因的菜单项使用可聚焦的禁用语义。父组件只禁用受该操作影响的控件，具体范围引用对应页面第 4 节。

### 2.3 状态类型与覆盖

| 类型   | 适用状态                                                        | 使用组件                            |
| ------ | --------------------------------------------------------------- | ----------------------------------- |
| 操作型 | 默认、悬停、按下、焦点、不可操作、运行中                        | U01、U09、U10；业务组件内的操作入口 |
| 输入型 | 默认、悬停、焦点、不可操作、只读、错误；提交中按页面锁定输入    | U02、U11                            |
| 选择型 | 默认、悬停、按下、焦点、选中、不可操作；保存中保留已确认选择    | U03                                 |
| 内容型 | 默认、loading、ready、empty、partial、error；内部操作采用操作型 | U04—U08、U12；业务组件的内容区域    |

1. 静态文本与图片本身按内容型呈现；附属链接或按钮使用 U01。每个组件的状态类型与专用状态见第 4、5 节。
2. 结果待确认与普通加载分别由 WriteState 和 ReadState 表达。U06 将状态与其可用操作一起展示，页面继续采用阶段 4 的结果核对规则。

## 3. 设计变量

### 3.1 命名与赋值

1. CSS 变量使用用途名称；组件尺寸引用下表变量。空间尺寸为 CSS 像素，动效时长使用毫秒；字重和层级序号是无单位数值。组件通过变量消费当前取值。
2. 颜色表中的浅色、深色两列对应同名变量在两种主题下的值。主题解析由宿主完成；组件只读取当前作用域中的变量。

### 3.2 颜色与主题映射

| Token                      | 浅色值    | 深色值    | 用途                       |
| -------------------------- | --------- | --------- | -------------------------- |
| `--color-primary`          | #315D49   | #A7CDB2   | 主操作、链接               |
| `--color-primary-hover`    | #264C3B   | #BCDCC4   | 主操作悬停                 |
| `--color-primary-pressed`  | #1D3F30   | #94BD9F   | 主操作按下                 |
| `--color-on-primary`       | #FFFEFA   | #172D20   | 主操作上的文字及图标       |
| `--color-danger`           | #A03932   | #F0A49B   | 删除操作                   |
| `--color-danger-hover`     | #872C28   | #F6B7AF   | 删除操作悬停               |
| `--color-danger-pressed`   | #712421   | #DE8E85   | 删除操作按下               |
| `--color-on-danger`        | #FFFEFA   | #3B1917   | 删除操作上的文字及图标     |
| `--color-success`          | #326548   | #9ACBA8   | 已确认成功                 |
| `--color-warning`          | #865014   | #E7BE7B   | 结果待确认及需要处理的状态 |
| `--color-error`            | #A03932   | #F0A49B   | 请求失败、字段错误         |
| `--color-info`             | #315F80   | #9CC6E2   | 读取、运行及一般说明       |
| `--color-text-primary`     | #24362F   | #E7ECE5   | 标题与正文                 |
| `--color-text-secondary`   | #526158   | #BCC8BD   | 摘要、提示与元信息         |
| `--color-text-placeholder` | #5C685F   | #A5B6A8   | 输入占位说明               |
| `--color-text-disabled`    | #5E685F   | #A0B0A2   | 不可操作控件文字           |
| `--color-border`           | #748172   | #859887   | 控件可辨认边界             |
| `--color-border-selected`  | #35634F   | #A7CDB2   | 选中项边框                 |
| `--color-focus`            | #35634F   | #A7CDB2   | 键盘焦点轮廓               |
| `--color-bg-page`          | #F6F5F1   | #171D19   | 站点页面背景               |
| `--color-bg-surface`       | #FFFEFA   | #202923   | 卡片、表单、覆盖层表面     |
| `--color-bg-hover`         | #EDEFE8   | #2B382F   | 中性控件悬停               |
| `--color-bg-pressed`       | #E0E5DA   | #35483B   | 中性控件按下               |
| `--color-bg-selected`      | #E4EDE2   | #304537   | 选中项表面                 |
| `--color-bg-disabled`      | #E9E8E1   | #2B322D   | 不可操作控件表面           |
| `--color-bg-mask`          | #14251E66 | #0B140DB3 | 模态背景                   |
| `--color-shadow`           | #16251B1F | #00000066 | 阴影颜色与透明度           |
| `--color-divider`          | #D9DED3   | #3D4C40   | 装饰性内容分隔与卡片描边   |

### 3.3 字体与文本层级

| Token                    | 值                                                                                             | 用途                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `--font-family-zh`       | `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", SimHei, "Noto Sans CJK SC", sans-serif` | 中文与平台降级链           |
| `--font-family-en`       | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`                         | 英文                       |
| `--font-family-num`      | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`                         | 数字与候选序号             |
| `--font-size-title`      | 24px                                                                                           | 页面主标题                 |
| `--line-height-title`    | 36px                                                                                           | 主标题行高                 |
| `--font-size-section`    | 20px                                                                                           | 区块标题                   |
| `--line-height-section`  | 28px                                                                                           | 区块标题行高               |
| `--font-size-body`       | 16px                                                                                           | 正文、输入、主要操作       |
| `--line-height-body`     | 28px                                                                                           | 长文与消息正文             |
| `--font-size-meta`       | 14px                                                                                           | 标签、辅助文字、快捷键提示 |
| `--line-height-meta`     | 22px                                                                                           | 辅助文字行高               |
| `--font-weight-body`     | 400                                                                                            | 正文                       |
| `--font-weight-emphasis` | 600                                                                                            | 标题及关键操作             |
| `--font-family-code`     | `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`                                   | 正文中的代码               |
| `--font-size-card`       | 18px                                                                                           | 角色与人格条目标题         |
| `--line-height-card`     | 26px                                                                                           | 条目标题行高               |
| `--line-height-control`  | 24px                                                                                           | 按钮与单行字段行高         |

1. 两端正文与输入框共用正文的字号和行高；数字采用等宽数字排版。正文容器允许浏览器文字放大和换行。

### 3.4 间距、控件与内容尺寸

| Token                  | 值                       | 用途                             |
| ---------------------- | ------------------------ | -------------------------------- |
| `--space-xs`           | 4px                      | 图标与紧邻说明                   |
| `--space-sm`           | 8px                      | 控件内元素及紧邻操作             |
| `--space-md`           | 12px                     | 字段内边距、列表内分组           |
| `--space-lg`           | 16px                     | 卡片内边距、手机页面边距         |
| `--space-xl`           | 24px                     | 分组间距、桌面页面边距           |
| `--space-xxl`          | 32px                     | 页面主要区块间隔                 |
| `--space-control-gap`  | 引用 `--space-sm`        | 独立操作之间的距离               |
| `--space-focus-offset` | 2px                      | 焦点轮廓与控件距离               |
| `--size-target-min`    | 44px                     | 两端独立操作目标的最小边长       |
| `--size-control`       | 引用 `--size-target-min` | 标准按钮与单行字段最小高度       |
| `--size-control-large` | 48px                     | 主要提交操作最小高度             |
| `--size-icon`          | 20px                     | 导航、按钮、消息操作图标         |
| `--size-icon-small`    | 16px                     | 状态与辅助图标                   |
| `--size-choice-mark`   | 20px                     | 单选和多选标记本体               |
| `--size-textarea-min`  | 112px                    | 人格描述和消息编辑最小输入高度   |
| `--size-textarea-max`  | 320px                    | 多行输入自动增高的上限           |
| `--size-sidebar`       | 224px                    | 桌面主导航宽度                   |
| `--size-content-max`   | 1200px                   | 站点主要内容最大宽度             |
| `--size-reading-max`   | 760px                    | 默认聊天与说明正文的阅读宽度     |
| `--size-form-max`      | 480px                    | 账号表单最大宽度                 |
| `--size-overlay-max`   | 640px                    | 对话框最大宽度                   |
| `--size-menu-min`      | 192px                    | 消息与条目菜单期望最小宽度       |
| `--size-tooltip-max`   | 320px                    | 补充提示最大宽度                 |
| `--size-prose-max`     | 640px                    | 通用聊天正文行宽上限             |
| `--size-nav-desktop`   | 64px                     | 桌面站点顶栏最小高度             |
| `--size-nav-mobile`    | 56px                     | 手机顶栏最小高度                 |
| `--size-nav-bottom`    | 64px                     | 手机主导航最小高度，安全区域另计 |
| `--size-card-min`      | 232px                    | 桌面角色网格期望最小列宽         |
| `--size-state-art`     | 64px                     | 空态辅助图形边长                 |
| `--icon-stroke-width`  | 1.5px                    | 显示图标线宽                     |

1. 尺寸中的最小高度允许内容换行后增高；可用宽度优先约束最大宽度及菜单宽度。U02 的多行字段在可见视口不足时保持最小可编辑区域，由页面滚动承载其余内容。
2. 图标和选择标记的外层目标使用 `--size-target-min`；相邻目标各自占据独立区域。正文中的普通链接随文本流排版，独立导航或操作链接采用控件目标尺寸。

### 3.5 圆角、边框与层级

| Token                  | 值                                     | 用途                       |
| ---------------------- | -------------------------------------- | -------------------------- |
| `--radius-small`       | 4px                                    | 标签、选择标记             |
| `--radius-control`     | 8px                                    | 按钮、字段、菜单项         |
| `--radius-surface`     | 12px                                   | 内容卡片、对话框与手机面板 |
| `--border-width`       | 1px                                    | 普通边框                   |
| `--border-focus-width` | 2px                                    | 焦点轮廓                   |
| `--shadow-surface`     | `0px 2px 8px 0px var(--color-shadow)`  | 浮动菜单与提示             |
| `--shadow-overlay`     | `0px 8px 24px 0px var(--color-shadow)` | 宿主覆盖层                 |
| `--layer-content`      | 0                                      | 页面正文                   |
| `--layer-sticky`       | 10                                     | 粘附导航与操作             |
| `--layer-menu`         | 20                                     | 页内菜单                   |
| `--layer-overlay`      | 30                                     | 宿主模态覆盖层             |
| `--layer-hint`         | 40                                     | 当前活动表面内的补充提示   |

1. 层级序号在宿主组件的层叠上下文内使用。弹层内菜单与提示跟随该弹层，覆盖层打开时只让当前活动表面参与焦点与指针交互。

### 3.6 动效变量

| Token                        | 值                           | 消费场景                 |
| ---------------------------- | ---------------------------- | ------------------------ |
| `--motion-duration-feedback` | 120ms                        | 状态、选择、菜单内容更新 |
| `--motion-duration-page`     | 180ms                        | 页面进入与离开           |
| `--motion-duration-overlay`  | 180ms                        | 对话框与手机面板         |
| `--motion-duration-scroll`   | 160ms                        | 用户触发的阅读定位       |
| `--motion-easing-standard`   | `cubic-bezier(0.2, 0, 0, 1)` | 上述过渡的标准缓动       |

1. 动效触发和中断条件采用对应页面第 6、10 节。减少动态效果偏好启用时直接完成状态和定位；加载、保存和错误仍使用可读文字表达。

## 4. 基础组件

### 4.1 U01：操作按钮与链接（ActionControl）

1. 用于页面提交、取消、返回和菜单触发。状态类型为操作型，属性与变体如下。

| 属性     | 类型／选项       | 默认     | 说明                              |
| -------- | ---------------- | -------- | --------------------------------- |
| action   | ActionSpec       | 必填     | 文案、层级及可用状态              |
| kind     | button / link    | button   | 资源导航使用 link，并提供目标地址 |
| href     | string           | 空       | kind 为 link 时必填的导航地址     |
| size     | standard / large | standard | 采用对应控件高度                  |
| icon     | 图标标识         | 空       | 图标可与文字并列                  |
| iconOnly | boolean          | false    | 为 true 时仍提供完整可访问名称    |

2. 事件为 activate；链接保留浏览器导航语义。标准尺寸使用 `--size-control`、`--space-lg` 水平内边距、正文阶梯与 `--radius-control`；large 使用 `--size-control-large` 和 `--space-xl`。纯图标按钮采用目标最小边长。
3. 按钮支持 Enter、Space，链接支持 Enter；快捷键由具体页面赋予。运行中保留按钮尺寸与进度文案。与 U06 配合展示错误或不可操作原因，删除确认中的危险操作由 D15 提供目标文案。

### 4.2 U02：字段（FormField）

| 属性                | 类型／选项                          | 默认               | 说明                          |
| ------------------- | ----------------------------------- | ------------------ | ----------------------------- |
| field               | FieldSpec                           | 必填               | 标签、校验与说明              |
| modelValue          | string                              | 必填               | 页面管理的输入值              |
| kind                | text / email / password / multiline | text               | 输入语义                      |
| readonly / disabled | boolean                             | false              | 只读与不可操作分别表达        |
| autocomplete        | 浏览器自动填充标识                  | 由页面提供         | 账号字段采用 P05、P06 第 4 节 |
| revealable          | boolean                             | password 时为 true | 密码显隐使用 U01              |

1. 状态类型为输入型；事件为 update:modelValue、submitIntent、blur。组件传递输入法状态，页面据此判断提交。单行最小高度采用 `--size-control`，内边距采用 `--space-md`，多行高度采用 textarea 尺寸变量。
2. 适用于姓名、标题、搜索和多行描述；字段始终保留标签，hint 与 error 分别关联输入。密码显隐状态属于当前字段，原生粘贴、撤销、文本选择和密码管理器行为按页面规定保留。

### 4.3 U03：单选与多选（ChoiceGroup）

| 属性             | 类型／选项                            | 默认                          | 说明                   |
| ---------------- | ------------------------------------- | ----------------------------- | ---------------------- |
| mode             | single / multiple                     | single                        | 单选值或多选集合       |
| modelValue       | string 或 string 集合                 | 必填，可为空                  | 当前选中标识           |
| options          | 标识、标签、摘要、availability 的列表 | 必填                          | 目标与可用原因         |
| label / required | string / boolean                      | label 必填；required 为 false | 选择组说明             |
| mixed            | boolean                               | false                         | 总选择框的部分选中状态 |

1. 状态类型为选择型；事件为 update:modelValue。单选采用方向键与空格，多选按各复选框切换；标签与标记共同构成目标，摘要内独立操作使用 U01。
2. 标记本体、目标和间距采用第 3.4 节变量，选项随文本增高。适用于分类、人格、开场与历史勾选；默认人格保存操作仍使用 D04 的明确操作。

### 4.4 U04：可读内容（ReadableContent）

| 属性         | 类型／选项          | 默认      | 说明                       |
| ------------ | ------------------- | --------- | -------------------------- |
| title / body | string 或已处理正文 | body 必填 | 姓名、介绍、快照与消息文本 |
| mode         | full / excerpt      | full      | 摘要模式须提供完整阅读目标 |
| meta         | 标签和值的列表      | 空        | 作者、时间及身份等元信息   |
| readState    | ReadState           | ready     | 内容读取状态               |

1. 状态类型为内容型。正文使用正文阶梯、元信息使用辅助阶梯；默认阅读宽度采用 `--size-reading-max`，空间由容器分配。
2. 段落可选择、复制，宽代码和表格在内容内部滚动。链接通过 U01 的链接语义呈现；可选字段缺失时由业务组件决定省略或显示缺失说明。角色自定义 HTML 的执行与渲染由 D11 承载。

### 4.5 U05：角色图像（RoleImage）

| 属性             | 类型／选项        | 默认                          | 说明                 |
| ---------------- | ----------------- | ----------------------------- | -------------------- |
| src              | 资源地址或空值    | 必填                          | 当前角色资源         |
| alt / decorative | string / boolean  | alt 必填；decorative 为 false | 文字替代方式         |
| shape            | cover / thumbnail | cover                         | 卡片、详情与摘要图像 |
| reserve          | 宽高或容器约束    | 必填                          | 预留图像位置         |

1. 状态类型为内容型，专用状态为 loading、ready、error、missing；事件为 load、error。图像最大宽度受容器约束，圆角采用 `--radius-surface`。
2. 失败时保留名称或替代文本；作为导航时由外层 U01 承载。封面适配采用[阶段 6 第 4.2 节](phase6-visual.md)。

### 4.6 U06：状态与恢复反馈（StatusFeedback）

| 属性           | 类型／选项                            | 默认       | 说明                   |
| -------------- | ------------------------------------- | ---------- | ---------------------- |
| source         | read / write / runtime                | 必填       | 状态来源               |
| state          | ReadState / WriteState / RuntimeState | 必填       | 当前可确认的结果       |
| title / detail | string                                | title 必填 | 状态及可操作原因       |
| actions        | ActionSpec 列表                       | 空         | 重试、核对或返回       |
| placement      | inline / region / page                | inline     | 字段旁、内容区或结果页 |
| announce       | polite / off                          | polite     | 连续正文更新采用 off   |

1. 状态类型为内容型，操作复用 U01；事件为 activate。区域内边距采用 `--space-lg`，字段旁采用 `--space-sm`；文字与状态图标使用对应颜色语义。
2. 用于加载、空内容、失败、部分成功和结果待确认。未知进度显示文字及不定进度标记；已确认的逐项数量由调用方提供。关键失败和待确认持续显示至状态改变，结果页面由本组件的 page 变体承载。

### 4.7 U07：集合与追加（ResourceCollection）

| 属性      | 类型／选项                          | 默认      | 说明                 |
| --------- | ----------------------------------- | --------- | -------------------- |
| items     | 带稳定标识的条目列表                | 必填      | 由业务组件渲染每项   |
| readState | ReadState                           | 必填      | 首批及刷新状态       |
| count     | CountValue                          | 必填      | 总数或加载范围       |
| next      | ready / loading / error / exhausted | exhausted | 追加入口状态         |
| anchorId  | 条目标识或空值                      | 空        | 返回与追加的阅读定位 |

1. 状态类型为内容型；事件为 loadMore、retry、anchorChange。列表间距采用 `--space-lg`，追加操作使用 U01，加载与空态使用 U06。
2. 用于角色、人格、会话和消息列表；保持稳定标识及可访问顺序。消息反向加载的定位规则由 D12 指定；集合计数按 CountValue 表达。

### 4.8 U08：宿主覆盖层（HostOverlay）

| 属性         | 类型／选项             | 默认         | 说明                     |
| ------------ | ---------------------- | ------------ | ------------------------ |
| open / title | boolean / string       | 必填         | 当前显示与名称           |
| presentation | dialog / sheet         | 由端布局提供 | 桌面对话框、手机底部面板 |
| returnFocus  | 控件引用或定位信息     | 必填         | 关闭后的焦点目标         |
| closeIntent  | ActionSpec             | 必填         | 关闭动作及可用条件       |
| initialFocus | title / cancel / field | title        | 按页面任务指定           |

1. 状态类型为内容型；事件为 requestClose，关闭结果由宿主页决定。最大宽度采用 `--size-overlay-max`，内边距采用 `--space-xl`，圆角、阴影和层级采用覆盖层变量；正文可滚动，操作区保持可达。
2. Tab 在活动覆盖层内循环，Esc、外部点击及手机返回统一发出关闭意图。焦点恢复、草稿确认及请求继续核对由具体页面处理。P19 与 P20 使用同一活动覆盖层切换内容，返回位置由宿主保存。

### 4.9 U09：操作菜单（ActionMenu）

| 属性             | 类型／选项       | 默认 | 说明               |
| ---------------- | ---------------- | ---- | ------------------ |
| open / triggerId | boolean / string | 必填 | 菜单及触发入口     |
| actions          | ActionSpec 列表  | 必填 | 当前资源提供的动作 |
| targetLabel      | string           | 必填 | 菜单所属消息或会话 |

1. 状态类型为操作型；事件为 activate、requestClose。菜单使用 `--size-menu-min`、`--space-sm`、`--radius-surface` 与表面阴影；每项采用标准操作高度，宽度受可见视口约束。
2. 可见按钮触发，方向键移动、Enter 激活、Esc 关闭；禁用项可读取原因。适用于消息和历史条目，关闭后的焦点回到对应触发按钮。

### 4.10 U10：内容展开（ContentDisclosure）

| 属性                        | 类型／选项 | 默认  | 说明               |
| --------------------------- | ---------- | ----- | ------------------ |
| modelValue                  | boolean    | false | 是否展开           |
| expandLabel / collapseLabel | string     | 必填  | 明确阅读或收起对象 |
| regionId                    | string     | 必填  | 对应内容区         |

1. 状态类型为操作型；事件为 update:modelValue。触发控件复用 U01，正文使用 U04；aria-expanded 与受控值一致。
2. 用于开场全文及已有长文展开。内容按文档流增高；加载与失败由 U06 在展开区呈现，焦点保留在触发控件。

### 4.11 U11：行内编辑（InlineEditor）

| 属性                 | 类型／选项              | 默认 | 说明               |
| -------------------- | ----------------------- | ---- | ------------------ |
| editing / modelValue | boolean / string        | 必填 | 当前模式与草稿     |
| savedValue           | string                  | 必填 | 当前已保存正文     |
| field                | FieldSpec               | 必填 | U02 的字段约束     |
| writeState           | WriteState              | idle | 保存结果           |
| actions              | 保存与取消的 ActionSpec | 必填 | 由页面决定取消语义 |

1. 状态类型为输入型，读取模式使用 U04，编辑模式使用 U02；事件为 edit、update:modelValue、save、cancel。尺寸继承对应字段，操作间距采用 `--space-control-gap`。
2. 适用于昵称、历史标题和消息编辑。当前保存值与草稿的来源分别标明；变化提示复用 U06。提交键、取消确认及草稿生命周期引用对应页面第 4、7 节。

### 4.12 U12：补充提示（TextHint）

| 属性           | 类型／选项       | 默认   | 说明               |
| -------------- | ---------------- | ------ | ------------------ |
| text / ownerId | string / string  | 必填   | 提示文字与所属控件 |
| mode           | inline / tooltip | inline | 常驻说明或补充说明 |

1. 状态类型为内容型；tooltip 由悬停或键盘焦点显示，Esc 关闭。最大宽度、间距与层级采用提示变量，文字采用辅助阶梯。
2. 用于快捷键或截断名称的补充阅读；关键操作原因使用 inline。手机通过常驻文字、详情或可见展开入口取得完整信息，具体入口见页面规格。

## 5. 业务组件

### 5.1 D01：站点导航（SiteNavigation）

1. 用于站点侧栏、手机底栏、页面标题和返回入口。属性为 `layout: desktop / mobile`（必填）、`level: primary / child / auth`（必填）、`items`（必填）、`activeId`（必填，可为空）、`title`（必填）、`accountAction?`、`backAction?`；事件为 navigate、account、back。
2. items 使用阶段 2 第 4.1 节的导航映射，导航动作复用 U01。状态采用操作型，当前项额外表达 aria-current；身份读取期间由 U06 承载反馈。侧栏宽度采用 `--size-sidebar`，主导航项采用标准操作高度，顶栏高度随标题换行增长。
3. primary 承载主导航，child 提供来源返回，auth 承载账号页返回。跨宽度与双端安排见第 6 节；会话导航由 D10 承载。

### 5.2 D02：角色资料（CharacterView）

1. 属性为 `resourceKey`、`name`（必填），`summary?`、`description?`、`author?`、`tags?`、`image?`，`variant: card / detail / summary`（默认 card），`actions`（默认空）；事件通过 U01 返回 actionId 和目标。
2. 使用 U04、U05、U06 及 U01，状态采用内容型与附属操作型；数据缺失的呈现引用 P01、P03 第 4 节。card 内边距采用 `--space-lg`，detail 的正文采用阅读宽度，summary 随所在表单宽度排列。
3. 适用于角色列表、详情和开始前的角色摘要。可开始资格由页面提供的 actions 决定，固定角色资源与会话身份的对应关系由页面控制器管理。

### 5.3 D03：账号摘要与资源入口（AccountSummary）

1. 属性为 `resourceKey`、`nickname`、`accountLabel`（必填）、`personaCount`、`sessionCount`（CountValue，必填）、`readState`（必填）、`nicknameEditor`（U11 输入，必填）、`actions`（ActionSpec 列表，必填）；昵称编辑透传 U11 事件，资源与账号操作返回 activate(actionId)。
2. 组合 U04、U06、U11 和 U01，状态采用内容型；昵称编辑使用输入型。资料内边距采用 `--space-lg`，资源组间距采用 `--space-xl`。
3. 用于 P07、P08，字段来源和局部统计失败采用 P07 第 4 节。昵称保存值与草稿通过 U11 管理呈现。

### 5.4 D04：人格资料与选择（PersonaView）

1. 属性为 `source: library / snapshot`（必填），`name`、`description`、`readState`（必填），`variant: manage / option / detail`（必填），`resourceKey`（必填），`selected?`、`defaultState?`、`actions?`。library 使用人格标识，snapshot 使用会话标识；snapshot 对应 detail。
2. manage 通过 U01 提供查看、默认与删除意图，option 作为 U03 选项的资料内容，由外层选择组统一管理选中值，detail 使用 U04 展示完整描述；状态分别采用操作型、选择型和内容型。条目内边距采用 `--space-lg`，完整描述采用阅读宽度。
3. 适用于 P09—P14、P19、P20。人格快照与人格库的展示规则引用需求规格第 3 节；defaultState 由页面提供 confirmed、pending 或 unknown，并按 P09 呈现。

### 5.5 D05：开场选择与预览（OpeningPicker）

1. 属性为 `releaseId`、`options`、`modelValue`、`readState`（必填），`preview`（所选正文及读取状态，必填）；事件为 select、retryPreview。选项具有稳定标识、标题、摘要及可用类型。
2. 组合 U03、U04、U10 和 U06；选择采用选择型，预览采用内容型。选择组间距采用 `--space-lg`，预览内边距采用相同变量。
3. 用于 P13、P14，默认选择和全文加载引用 P13 第 4、7 节。页面传入已确认的选中值，预览结果带有所属开场标识。

### 5.6 D06：账号表单（AccountForm）

1. 属性为 `mode: login / register`（必填）、`fields`（FieldSpec 与受控字段值，必填）、`writeState`（必填）、`actions`（必填）、`simulationLabel?`；事件为 fieldChange、submit、switchMode、back、verify。
2. 组合 U02、U01 与 U06，状态采用输入型及内容型，表单宽度采用 `--size-form-max`，字段间距采用 `--space-lg`。
3. 登录及注册字段、自动填充、密码保留与原目标恢复分别引用 P05、P06。组件呈现传入的校验结果，账号服务由页面控制器访问。

### 5.7 D07：人格表单（PersonaForm）

1. 属性为 `mode: create / edit`（必填）、`fields`（姓名和描述，必填）、`readState`、`writeState`（必填）、`savedValues?`、`draftNotice?`、`actions`（必填）；事件为 fieldChange、submit、cancel、resolveDraft。
2. 组合 U02、U06 和 U01，状态采用输入型；字段读取失败采用内容型。表单随容器铺开，描述字段使用 textarea 尺寸变量。
3. 用于 P11、P12，来源返回及资料变化采用对应页面规则；已保存资料与恢复草稿分别传入，组件按明确标签呈现。

### 5.8 D08：历史会话条目（SessionItem）

1. 属性为 `resourceKey`、`title`、`characterName`、`personaName`、`updatedAt`（必填），`selected`（默认 false）、`selectable`（必填）、`actions`（必填）、`titleEditor?`；事件为 continue、select、rename、delete。
2. 组合 U04、U03、U09、U11 和 U01，状态采用内容型与附属控件状态；条目内边距采用 `--space-lg`，内部操作间距采用 `--space-control-gap`。
3. 用于 P15、P16，继续目标、运行中删除资格及标题编辑规则引用 P15 第 4 节。titleEditor 承载 U11 的受控输入，条目保持稳定会话标识。

### 5.9 D09：批量选择栏（SelectionToolbar）

1. 属性为 `loadedIds`、`eligibleIds`、`selectedIds`（必填集合）、`mode: always / managed`（必填）、`expanded`（默认 false）、`deleteAction`（必填）；事件为 enter、selectLoaded、clear、deleteSelected、finish。
2. 使用 U03、U01 与 U06；状态采用选择型和操作型。栏内间距采用 `--space-control-gap`，换行后的行间距采用 `--space-sm`。
3. 用于 P15、P16。选择范围、总选择框的部分选中状态、查询变化与管理完成的行为引用对应页面第 4 节；删除目标在 D15 打开时由页面固定。

### 5.10 D10：独立会话框架（SessionShell）

1. 属性为 `resourceKey`、`title`、`characterName`、`personaName`（必填）、`runtimeState`（RuntimeState，必填）、`runFeedback`（U06 输入，必填）、`actions`（必填）、`layout: desktop / mobile`（必填）；事件为 backHistory、openSettings、openSnapshot、stop、verify、retryRuntime。
2. 框架组合通用导航、U06、D11 与宿主 U08 覆盖层；状态采用内容型及附属操作型，具体运行状态引用 P17 第 5 节。会话框架使用全部可用宽度，顶部控件采用标准操作高度。
3. P17、P18 的布局由本组件承载。Runtime 区域取得剩余可见空间，宿主返回及恢复入口保持在角色区域之外；角色自定义布局与默认聊天模式采用页面第 2 节。

### 5.11 D11：角色挂载区域（RoleRuntimeMount）

1. 设计输入为会话控制器持有的固定角色资源描述、Runtime 实例及目标容器；事件仅上报 ready、failed 与布局可用性。实际入口、挂载及释放方式直接采用[当前 Runtime 实现](../../../apps/user-web/src/runtime/script-runtime.ts)及 Runtime 架构文档。
2. 状态采用内容型，角色失败反馈由外层 D10 的 U06 呈现。容器尺寸由 D10 与角色布局分配；角色的图像、面板、剧情按钮和色彩由角色交付内容决定。
3. 通用聊天由 D12、D13、D14 组成，在 Runtime 支持的挂载位置消费同一会话控制器。账号、会话、分支及版本变化按现有生命周期处理；视口与键盘变化只更新布局约束。

### 5.12 D12：对话记录（MessageTranscript）

1. 属性为 `resourceKey`、`messages`、`readState`、`previousPageState`（必填）、`anchorId?`、`followLatest`（必填）；每条消息携带说话者、正文、保存状态与可用 actions，并按当前模式提供 `editor?`（U11 输入）与 `candidates?`（D14 输入）。事件为 loadEarlier、backToLatest、messageAction、editMessage、anchorChange。
2. 组合 U07、U04、U09、U11、U06 和 D14；状态采用内容型，逐条动作及编辑分别复用对应基础状态。默认聊天正文使用 `--size-reading-max`，角色挂载时由其容器约束宽度；消息间距采用 `--space-xl`。
3. P17 第 4.1—4.3 节规定阅读、操作及保存语义。流式正文与已保存正文带有各自状态标记，组件只展示控制器传入的实际结果。

### 5.13 D13：消息输入与运行操作（MessageComposer）

1. 属性为 `resourceKey`、`personaName`、`modelValue`（必填）、`sendAction`、`stopAction`（必填）、`layout`（必填）、`runFeedback`（必填）；事件为 update:modelValue、send、stop。
2. 组合 U02、U01 与 U06，状态采用输入型和操作型；输入采用正文阶梯，编辑区由当前容器分配空间，动作间距采用 `--space-control-gap`。输入框最小高度采用标准控件高度，增高上限采用 `--size-textarea-max`。
3. 发送键、输入法、下一条草稿和停止操作分别引用 P17、P18 第 4 节。输入和停止可以具有不同可用状态，由同一控制器提供。

### 5.14 D14：候选回复切换（CandidatePicker）

1. 属性为 `resourceKey`、`candidateIds`、`activeId`（必填）、`previousAction`、`nextAction`（必填）、`writeState`（必填）；事件为 select(candidateId)。候选数量由实际列表派生。
2. 状态采用选择型与操作型。两侧方向按钮使用标准操作目标，序号采用辅助阶梯和数字字体变量，控件间距采用 `--space-control-gap`。
3. 用于 P17、P18，激活、边界与失败恢复引用 P17 第 4.3 节 C06；候选只有一项时由消息组件按页面规则组织入口。

### 5.15 D15：删除目标与结果（DeleteReview）

1. 属性为 `kind: persona / session / sessions / message`（必填）、`targets`、`impactText`、`writeState`、`outcomes`、`actions`（必填）；targets 包含可识别名称及 ResourceKey。事件为 confirm、verify、retryEligible、return。
2. 组合 U08、U04、U07、U06 和 U01；状态采用内容型与操作型。清单内边距采用 `--space-lg`，确认操作使用 danger 变体，覆盖层尺寸由 U08 提供。
3. P21 是确认文案、删除范围与逐项结果的唯一页面依据。批量目标、可重试集合与结果关联由宿主页提供，关闭覆盖层后请求状态仍由宿主页管理。

## 6. 双端布局与浏览器适配

### 6.1 宽度变量与布局区间

| Token                  | 值     | 用途                     |
| ---------------------- | ------ | ------------------------ |
| `--breakpoint-tablet`  | 768px  | 手机窄列与平板宽列的分界 |
| `--breakpoint-desktop` | 1024px | 站点桌面导航的布局分界   |
| `--breakpoint-wide`    | 1440px | 桌面宽屏的内容留白分界   |

| 区间                   | 站点组件组织                                 | 内容密度                                        |
| ---------------------- | -------------------------------------------- | ----------------------------------------------- |
| 小于 tablet            | 手机底部主导航；子页返回顶栏；角色与历史单列 | 手机页面边距采用 space-lg，控件使用共同目标尺寸 |
| tablet 至 desktop 之前 | 手机任务结构，表单与阅读内容在最大宽度内居中 | 页面边距采用 space-xl；P14 仍按单列选择         |
| desktop 至 wide 之前   | 桌面侧栏与顶栏，角色网格按可用宽度排列       | 主内容采用 content-max，角色详情可并排          |
| wide 及以上            | 保持桌面任务组织，内容外侧增加留白           | 表单、正文和菜单继续使用各自最大宽度            |

1. 布局测量使用当前浏览器可用宽度。实际 CSS 断点规则从同一结构化变量配置派生；配置来源采用第 1 节的设计变量配置，Markdown 用于规格阅读。
2. 双端原型分别采用阶段 1 约定的交付入口。桌面原型窗口缩窄时保留其页面导航能力，允许导航与操作换行；手机原型在横屏下仍使用手机任务组织。

### 6.2 视口、键盘与内容约束

1. 浏览器工具栏、安全区域与软键盘共同决定可用空间。D10 的布局层负责可见高度，D13 在角色指定的聊天区域内保持输入与停止入口可达；角色布局约束采用 P18 第 2、8 节。
2. 页面边距、标准控件尺寸与字号阶梯共用第 3 节。两端通过单列、网格和分组调整信息量，正文、错误和操作文案允许换行。
3. 大字或短视口使粘附操作遮挡正文时，按对应页面第 2 节回到文档流。覆盖层正文可滚动，菜单可缩窄至视口内，表格与代码的滚动采用第 4.4 节规则。
4. 宿主样式作用于站点组件及通用聊天组件的根节点。角色挂载容器只承载布局约束；角色样式由 Runtime 管理，宿主选择器限于宿主组件范围。通用聊天在角色内挂载时显式取得宿主主题变量。

### 6.3 焦点与输入一致性

1. DOM 顺序与当前端的阅读顺序一致。键盘焦点使用第 2.2 节规则，图标按钮拥有对象明确的可访问名称。
2. 输入法组词、原生文本编辑与浏览器导航按页面规格处理。屏幕阅读器接收状态改变的文字，流式字符由正文阅读承载；已打开覆盖层只保留一个活动焦点范围。
3. 主题、字体放大、减少动态效果及触控能力通过浏览器环境传入组件呈现层；角色内容与宿主操作分别按各自职责适配。

## 7. 页面组件覆盖

1. 每行完整映射该页第 3 节的 C 编号；括号内的 U 组件表示业务组件的内部构成或页面直接组合。页面标题、普通说明和标签由 U04 承载。U12 承载 P13 第 8 节及 P17 第 10 节的悬停与键盘提示。

| 页面                                 | C 编号与复用组件                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [P01](phase4-page-specs/page-P01.md) | C01→D01；C02→U02+U01；C03→U03+U01；C04→U07；C05→D02；C06→U07+U06                                    |
| [P02](phase4-page-specs/page-P02.md) | C01→D01；C02→U02+U01；C03→U03+U01；C04→U07+D02；C05→U06+U07；C06→D01                                |
| [P03](phase4-page-specs/page-P03.md) | C01→D01；C02→D02；C03→U01；C04→U06                                                                  |
| [P04](phase4-page-specs/page-P04.md) | C01→D01；C02→D02；C03→U01；C04→U06                                                                  |
| [P05](phase4-page-specs/page-P05.md) | C01→D01；C02→D06(U02)；C03→D06(U02+U01)；C04→D06(U01)；C05→U01；C06→D06(U06)                        |
| [P06](phase4-page-specs/page-P06.md) | C01→D01；C02→D06(U02)；C03→D06(U02)；C04→D06(U02+U01)；C05→D06(U01)；C06→D06(U06)                   |
| [P07](phase4-page-specs/page-P07.md) | C01→D03；C02→D03(U11)；C03→D03(U01)；C04→D03(U01)；C05→D03(U01)；C06→D03(U06)                       |
| [P08](phase4-page-specs/page-P08.md) | C01→D03；C02→D03(U11)；C03→D03(U01)；C04→D03(U01+U06)；C05→D01                                      |
| [P09](phase4-page-specs/page-P09.md) | C01→U01；C02→D04；C03→D04(U01)；C04→D04(U01+U06)；C05→D04(U01)；C06→U07+U06                         |
| [P10](phase4-page-specs/page-P10.md) | C01→U01；C02→D04；C03→D04(U01+U06)；C04→D04(U01)；C05→U07+U06；C06→D01                              |
| [P11](phase4-page-specs/page-P11.md) | C01→D01+U01；C02→D07(U02)；C03→D07(U02)；C04→D07(U01)；C05→D07(U06)                                 |
| [P12](phase4-page-specs/page-P12.md) | C01→D01+U01；C02→D07(U02)；C03→D07(U01)；C04→D07(U06)                                               |
| [P13](phase4-page-specs/page-P13.md) | C01→D01；C02→D02；C03→U03(D04)；C04→U01；C05→D05(U03)；C06→D05(U10+U04)；C07→U01；C08→U06           |
| [P14](phase4-page-specs/page-P14.md) | C01→D01；C02→D02；C03→U03(D04)；C04→U01；C05→D05(U03)；C06→D05(U10+U04)；C07→U01；C08→U06           |
| [P15](phase4-page-specs/page-P15.md) | C01→U01；C02→U02+U01；C03→D08；C04→D09；C05→D08(U09+U11)；C06→U07+U06                               |
| [P16](phase4-page-specs/page-P16.md) | C01→U02+U01；C02→D08；C03→D09；C04→D09；C05→D08(U09+U11)；C06→U07+U06                               |
| [P17](phase4-page-specs/page-P17.md) | C01→D10；C02→D10(U06)；C03→D11；C04→D12；C05→D12(U09)；C06→D14；C07→D12(U11)；C08→D13；C09→D13(U01) |
| [P18](phase4-page-specs/page-P18.md) | C01→D10；C02→D10(U06)；C03→D11；C04→D12；C05→D12(U09)；C06→D14；C07→D12(U11)；C08→D13；C09→D13(U01) |
| [P19](phase4-page-specs/page-P19.md) | C01→U08(U01)；C02→U04+U01；C03→U02；C04→U01；C05→U06                                                |
| [P20](phase4-page-specs/page-P20.md) | C01→U08(U01)；C02→D04(U04)；C03→U06                                                                 |
| [P21](phase4-page-specs/page-P21.md) | C01→D15(U04)；C02→D15(U07)；C03→D15(U01)；C04→D15(U01)；C05→D15(U06)                                |
| [P22](phase4-page-specs/page-P22.md) | C01→U06(U04)；C02→U06(U04)；C03→U06(U01)                                                            |

## 8. 组件验收清单

| 验收内容                                 | 依据                        |
| ---------------------------------------- | --------------------------- |
| 页面清单中的全部 C 编号均有复用组件      | 第 7 节与阶段 4 各页第 3 节 |
| 每个组件具有输入、事件、尺寸与适用状态   | 第 2、4、5 节               |
| 不可操作、运行中与结果待确认分别呈现     | 第 2 节与 U06               |
| 两端独立操作目标、长文本及焦点可达       | 第 3.4、6 节                |
| 主题变量完整覆盖默认及交互状态           | 第 2.2、3.2 节              |
| 角色渲染、通用聊天及宿主导航职责清晰     | D10—D13、第 6.2 节          |
| 表单草稿、批量结果和会话保存使用页面结果 | D06—D15 与对应页面规格      |
| 阶段 4 引用的变量均在本文定义            | 第 3、6.1 节                |
