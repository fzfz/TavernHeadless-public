---
文档用途: 提供角色前端入口和 manifest 的配置格式。
读取时机: 转换 Agent 配置原生包的前端入口时。
---

<!-- markdownlint-disable MD013 MD033 -->

# 角色前端模板与脚本入口规范

## 用途

角色作者提供 HTML、CSS、JavaScript 和资源；后端保存固定版本并交付，前端运行角色代码。本文定义原生 ZIP 的前端清单、HTML、CSS、JavaScript 入口和资源引用，也说明运行快照的读取格式。

## 包入口

原生 ZIP 的根 `manifest.json` 使用 `frontend` 字段指向 `frontend/manifest.json`。前端清单以包根相对路径登记 HTML、CSS、入口脚本和资源；其中 `data` 将数据 ID 映射到 `data/*.json` 文件，后端读取固定版本中的 JSON 后交付 `delivery.data`。省略根 `frontend` 字段的纯对话包使用系统聊天界面，视图接口返回 `delivery.mode: "system_chat"` 和 `scriptUrl: null`，客户端直接挂载系统聊天组件。自定义前端使用 `custom` 模式，入口脚本 URL 指向固定版本资源。

已有角色快照将模板保存在 `snapshot.extensions.tavern_headless.frontend`。该结构包含 apiVersion、html、css、script、assets、data，以及可选的 floorHtml；apiVersion 固定为 1。html、css、script 引用角色版本中的文本资源，assets 将资源 ID 映射到类型、文件、label 和 tags；data 保存角色预置的 JSON 数据对象。data 的业务字段由角色函数解释，系统按 JSON 数据结构保存，资源字段使用 assets 中的 ID。后端检查结构、路径及引用并解析资源地址，再交付固定版本内容。后端固定 html、css、script、floorHtml 及 assets 对应的文件内容，并通过版本地址交付；同一版本继续返回同一套内容。字段结构见 [script-runtime.schema.json](script-runtime.schema.json)。

### HTML 内的资源地址

作者在 HTML 属性、`srcset`、内联样式和 `<style>` 中使用相对于当前 HTML 文件的资源路径；CSS 文件中的地址相对于该 CSS 文件。后端校验包内引用，并在交付 HTML 时将资源地址指向会话固定版本。外部 URL、数据 URL 和 `#` 片段引用保留原值。

自定义客户端从视图接口读取 `delivery.htmlUrl` 和可选的 `floorHtmlUrl`，并以 API 地址将它们解析为绝对 URL。`htmlAssetOriginOffsets` 与 `floorHtmlAssetOriginOffsets` 分别标记对应 HTML 字符串中需要插入资源 origin 的位置；位置按 UTF-16 字符串索引计数，严格递增且唯一。客户端从后向前在这些位置插入对应 HTML URL 的 origin，再挂载 HTML。后端只标记资源引用，正文中的相同文本保持原样。官方用户端已执行此步骤；角色作者只需填写包内路径。

已有角色快照示例：以下 JSON 保存到对应快照的 `snapshot.extensions.tavern_headless.frontend`。

```json
{
  "apiVersion": 1,
  "html": "view.html",
  "css": "view.css",
  "script": "main.js",
  "assets": {
    "calm": {
      "kind": "image",
      "file": "images/calm.webp",
      "label": "平静",
      "tags": ["portrait"]
    },
    "tired": {
      "kind": "image",
      "file": "images/tired.webp",
      "label": "疲惫",
      "tags": ["portrait"]
    },
    "bookshop": {
      "kind": "image",
      "file": "images/bookshop.webp",
      "label": "书店",
      "tags": ["background"]
    },
    "rain": {
      "kind": "audio",
      "file": "audio/rain.mp3",
      "label": "雨夜",
      "tags": ["bgm"]
    }
  },
  "data": {
    "scenes": {
      "bookshop": { "background": "bookshop", "music": "rain" }
    }
  }
}
```

原生 ZIP 清单示例：以下 JSON 保存到 ZIP 内的 `frontend/manifest.json`。`html`、`css`、`script`、每个 `assets` 项的 `file` 和 `data` 值都使用包根相对路径；`data` 的键是交付给前端的数据 ID，值指向包内 JSON 文件。

```json
{
  "apiVersion": 1,
  "html": "frontend/index.html",
  "css": "frontend/style.css",
  "script": "frontend/main.js",
  "assets": {
    "portrait": {
      "kind": "image",
      "file": "assets/portrait.webp",
      "label": "人物立绘",
      "tags": ["portrait"]
    }
  },
  "data": {
    "caseFile": "data/case.json"
  }
}
```

## 同一角色版本中的前后端模块

原生 ZIP 作者在 `frontend/manifest.json` 中登记浏览器入口，在 `agents/state-update/profile.json` 中登记后端更新配置。发布服务分别将两者保存到角色快照的 `extensions.tavern_headless.frontend` 和 `extensions.tavern_headless.stateUpdate`，并随角色版本固定。后端更新配置字段见[后端状态配置](backend-api.md#3-stateupdate配置变量更新)。

| 文件或数据                                | 执行或读取位置         | 职责                                             |
| ----------------------------------------- | ---------------------- | ------------------------------------------------ |
| HTML、CSS、frontend.script                | 用户 Web Runtime       | 布局、自定义函数、元素事件、文本流显示与资源切换 |
| assets、data                              | 后端固定后交付 Runtime | 媒体引用和角色预置数据                           |
| stateSchemaFile、ruleFiles、factsSchema   | 后端更新链路           | 变量结构、语义规则和模型事实输出约束             |
| deriveScript、validateScript、moduleFiles | 后端角色模块           | 同轮累计、确定性计算、跨字段校验与共享常量       |
| 模型槽位、Agent 绑定                      | 后端运行配置           | 选择生成及更新模型，调度参与状态更新的后续正文   |
| 已提交变量与显示快照                      | 后端保存，Runtime 读取 | 驱动状态栏、图片、选项和历史画面                 |

角色目录可以同时包含这两类代码。前端脚本由 `frontend/manifest.json` 的 `script` 指定，并使用 api 注册回调；后端模块由 `agents/state-update/profile.json` 的模块引用字段指定，并由系统更新链路调用。前端状态栏对数值取整属于显示计算，改变持久数值的累计或截断属于后端计算。

## HTML 与 CSS

HTML 定义角色自己的页面结构，CSS 定义页面布局、断点、背景和动画。Runtime 在同页面的 ShadowRoot 挂载 HTML 和 CSS，完成 API 初始化后调用入口。角色通过 ui.register 将选择器映射到稳定元素 ID，之后通过 ID 更新元素或绑定回调；注册与更新契约见[脚本 API](script-api.md#10-布局注册绑定和更新)。

HTML 文本按普通 HTML 呈现。常用动态文本、图片、显隐和控件状态通过 layout.update 或 layout.bind 更新，样式类用于切换布局和 CSS 动画。角色计算函数自由组装更新数据，Runtime 处理元素定位和更新操作。

## JavaScript 入口

script 文件导出 `mount({api})`，返回 `void | Promise<void>`；同步函数返回后完成挂载，异步函数返回的 Promise 成功完成后完成挂载。该函数注册布局、绑定变量和页面回调，所有通过 api 创建的资源自动归属当前角色实例，销毁规则见[脚本 API 的生命周期](script-api.md#15-生命周期与错误)。原生 ZIP 的入口可通过相对 import 引用包内其他前端 JavaScript 或 JSON；导入校验检查引用文件、入口导出及公开 API 方法。

角色通过 widgets 命名空间在已注册的布局容器内挂载统一聊天组件；参数与返回值见脚本 API。角色 CSS 控制外部容器布局，组件内部样式和会话逻辑由系统维护。未挂载时，用户通过宿主聊天入口使用同一个会话。

自定义历史楼层可使用 floorHtml 与 ui.mountFloors，资源归属、离屏释放和回看挂载规则见[楼层视图契约](script-api.md#14-楼层显示范围与资源释放)。角色提供楼层模板与显示函数，Runtime 负责按可见范围创建和销毁。

## 数据与交互

角色通过 [脚本 API](script-api.md)获取状态、订阅变化和调用宿主能力。变量结构沿用后端提供的公开快照；变量名称由角色配置决定。背景、立绘与消息头像是不同对象：前两者由作者脚本决定；逐条头像与消息权限由统一聊天组件管理。

角色作者可以使用普通函数计算多变量条件并选择资源。脚本 API 中的示例展示了完整入口、变量订阅、图片更新及事件绑定。

## 作者检查

导入服务检查 `frontend/*.js` 的语法、包内引用和公开 API 方法。未知方法、动态方法名或参数数量错误返回 `NATIVE_CARD_FRONTEND_MODULE_INVALID`，问题列出文件、行、列和修正动作。作者按[脚本 API](script-api.md)填写方法及参数；布局对象的 `animateVisibility` 用法见[布局 API](script-api.md#10-布局注册绑定和更新)。页面运行时按公共参数约束检查布局元素及动画。

- 核对前端清单中的 HTML、CSS、脚本及资源路径实际存在，并符合所选原生包结构。
- 核对脚本导出 `mount({api})`，异步初始化完成后能够实际挂载角色页面。
- 在页面读取正式状态，检查布局绑定、变量刷新、必要操作及实例释放。接口与错误处理见[脚本 API](script-api.md)。
