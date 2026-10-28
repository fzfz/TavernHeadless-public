---
文档用途: 汇集用户 Web 的设计规格、双端原型和开发交接入口。
读取时机: 评审完整设计、查找页面规则或开始用户 Web 实现时读取。
---

# TavernHeadless 用户 Web 交互设计说明书

## 交付信息与阅读方式

1. 版本：1.0。日期：2026-10-20。编制：Codex。目标平台：桌面与手机浏览器。
2. 本文按章节引用设计来源；[完整阅读版](phase8-document.html)展开来源正文、22 项页面规格和流程图。
3. 各项规则在来源文件中维护。完整阅读版收录各页面规格的第 1—8、10 节。页面验收记录的入口见附录 A。
4. 设计交付结果见[阶段 8 评审](phase8-review-round-1.md)。真实后端接入状态见附录 D。

## 目录

1. [第一章 设计概述](#第一章-设计概述)
2. [第二章 信息架构](#第二章-信息架构)
3. [第三章 用户流程](#第三章-用户流程)
4. [第四章 页面交互说明](#第四章-页面交互说明)
5. [第五章 组件规范](#第五章-组件规范)
6. [第六章 视觉设计](#第六章-视觉设计)
7. [第七章 全局交互规范](#第七章-全局交互规范)
8. [附录 A 原型演示](#附录-a-原型演示)
9. [附录 B 视觉样例](#附录-b-视觉样例)
10. [附录 C 设计资源](#附录-c-设计资源)
11. [附录 D 开发交接](#附录-d-开发交接)
12. [附录 E 页面覆盖](#附录-e-页面覆盖)
13. [附录 F 键盘操作](#附录-f-键盘操作)

## 第一章 设计概述

1. 产品背景、目标与使用场景采用[产品背景第 1、3、5 节](phase1-context.md)。
2. 核心模块、范围与设计原则采用产品背景第 4、6、8 节。
3. 平台策略与设计参考采用产品背景第 2、7 节。
4. 领域术语采用[用户演绎领域第 1—2 节](../../../apps/user-web/CONTEXT.md)。

<!-- expand:phase1-context.md -->

## 第二章 信息架构

1. 页面清单、站点结构与双端导航映射采用[信息架构第 2—4 节](phase2-architecture.md)。
2. 共用界面职责、22 类页面覆盖与生命周期适用范围采用信息架构第 5—7 节。

<!-- expand:phase2-architecture.md -->

## 第三章 用户流程

1. F01—F05 的起止条件、步骤与决策采用[任务流程第 2—7 节](phase3-userflows.md)。
2. 页面恢复和提交结果核对采用任务流程第 8 节；后端接入约束采用第 9 节。
3. 浏览器窗口、安装和更新的职责采用信息架构第 7.2 节。

<!-- expand:phase3-userflows.md -->

## 第四章 页面交互说明

1. 每项页面的布局、组件、操作、状态、动效、数据、适配与微交互采用下表对应文件。页面间的引用方式采用[页面规格索引第 1 节](phase4-page-specs/README.md)。

| 模块 | 桌面规格 | 手机规格 | 双端共用规格 |
| --- | --- | --- | --- |
| 角色选择 | [P01 广场](phase4-page-specs/page-P01.md)、[P03 详情](phase4-page-specs/page-P03.md) | [P02 广场](phase4-page-specs/page-P02.md)、[P04 详情](phase4-page-specs/page-P04.md) | — |
| 账号访问 | [P07 用户中心](phase4-page-specs/page-P07.md) | [P08 用户中心](phase4-page-specs/page-P08.md) | [P05 登录](phase4-page-specs/page-P05.md)、[P06 注册](phase4-page-specs/page-P06.md) |
| 演绎人格 | [P09 人格列表](phase4-page-specs/page-P09.md) | [P10 人格列表](phase4-page-specs/page-P10.md) | [P11 创建](phase4-page-specs/page-P11.md)、[P12 编辑](phase4-page-specs/page-P12.md) |
| 开始演绎 | [P13 开始演绎](phase4-page-specs/page-P13.md) | [P14 开始演绎](phase4-page-specs/page-P14.md) | — |
| 历史管理 | [P15 历史列表](phase4-page-specs/page-P15.md) | [P16 历史列表](phase4-page-specs/page-P16.md) | — |
| 演绎会话 | [P17 演绎会话](phase4-page-specs/page-P17.md) | [P18 演绎会话](phase4-page-specs/page-P18.md) | [P19 演绎设置](phase4-page-specs/page-P19.md)、[P20 本次演绎人设](phase4-page-specs/page-P20.md) |
| 删除与访问结果 | — | — | [P21 删除确认](phase4-page-specs/page-P21.md)、[P22 页面无法访问](phase4-page-specs/page-P22.md) |

<!-- expand:phase4-page-specs/page-P01.md -->
<!-- expand:phase4-page-specs/page-P02.md -->
<!-- expand:phase4-page-specs/page-P03.md -->
<!-- expand:phase4-page-specs/page-P04.md -->
<!-- expand:phase4-page-specs/page-P05.md -->
<!-- expand:phase4-page-specs/page-P06.md -->
<!-- expand:phase4-page-specs/page-P07.md -->
<!-- expand:phase4-page-specs/page-P08.md -->
<!-- expand:phase4-page-specs/page-P09.md -->
<!-- expand:phase4-page-specs/page-P10.md -->
<!-- expand:phase4-page-specs/page-P11.md -->
<!-- expand:phase4-page-specs/page-P12.md -->
<!-- expand:phase4-page-specs/page-P13.md -->
<!-- expand:phase4-page-specs/page-P14.md -->
<!-- expand:phase4-page-specs/page-P15.md -->
<!-- expand:phase4-page-specs/page-P16.md -->
<!-- expand:phase4-page-specs/page-P17.md -->
<!-- expand:phase4-page-specs/page-P18.md -->
<!-- expand:phase4-page-specs/page-P19.md -->
<!-- expand:phase4-page-specs/page-P20.md -->
<!-- expand:phase4-page-specs/page-P21.md -->
<!-- expand:phase4-page-specs/page-P22.md -->

## 第五章 组件规范

1. 设计变量、基础组件与业务组件采用[组件规范第 2—5 节](phase5-components.md)。
2. 桌面侧栏、操作菜单、会话工具与焦点规则采用组件规范 U08、U09、D01、D10—D13。
3. 双端断点、视口、输入与信息密度采用组件规范第 6 节；页面组件映射采用第 7 节。

<!-- expand:phase5-components.md -->

## 第六章 视觉设计

1. 颜色、字体、图标、插图、阴影、圆角、栅格、页面类型标注、主题和动效采用[视觉设计第 1—10 节](phase6-visual.md)。
2. 变量值由 [phase6-tokens.json](phase6-tokens.json)提供；对比度结果见 [phase6-contrast.json](phase6-contrast.json)。

<!-- expand:phase6-visual.md -->

## 第七章 全局交互规范

| 范围 | 规则位置 |
| --- | --- |
| 手机触控、滚动、软键盘与安全区域 | 组件规范第 6.2 节；P18 第 4、8 节 |
| 鼠标、焦点、菜单与原生编辑 | 组件规范第 2.2、4.8、4.9、6.3 节；附录 F |
| 页面转场、覆盖层与减少动态效果 | 视觉设计第 10 节；各页面第 6 节 |
| 成功、失败、待确认与删除反馈 | 组件规范 U06、U08、D15；任务流程 S02 |
| 首次加载、刷新、分页与离线阅读 | 组件规范 U07；各页面第 7 节 |
| 网络、服务、格式与 Runtime 异常 | 任务流程 S01、S02；P17、P18、P22 第 5 节 |
| 登录失效与资源访问权限 | 任务流程 F01、S01；P05、P22 第 4、5 节 |
| 推送通知适用范围 | 信息架构第 7.2 节“通知生命周期” |
| 深色主题与浏览器强制颜色 | 视觉设计第 9 节 |
| 浏览器窗口与桌面生命周期 | 信息架构第 7.2 节；组件规范第 6 节 |

## 附录 A 原型演示

1. 打开[桌面原型](phase7-prototype-desktop.html)或[手机原型](phase7-prototype-mobile.html)。本机预览服务为 `http://127.0.0.1:4180/`。
2. 构建、启动方法和浏览器测试范围见[原型验收第 1、2.2 节](phase7-review-master.md)。逐页验收结果见该文件第 2—8 节。
3. 评审说明与模拟控件统一位于设备外框上方。

## 附录 B 视觉样例

1. [样式板](phase6-style-tile.html)展示变量、组件与双端布局。
2. 以下截图记录演绎页面的双端浅深色效果；图像对应的交互入口见附录 A。

| 平台 | 浅色 | 深色 |
| --- | --- | --- |
| 桌面 | [演绎页面](phase7-evidence/desktop-session-light.png) | [演绎页面](phase7-evidence/desktop-session-dark.png) |
| 手机 | [演绎页面](phase7-evidence/mobile-session-light.png) | [演绎页面](phase7-evidence/mobile-session-dark.png) |

## 附录 C 设计资源

1. 图标来源与尺寸采用视觉设计第 3 节；插图与角色媒体采用第 4 节；字体及降级链采用第 2.1 节。

## 附录 D 开发交接

### D.1 规则与实现入口

1. 产品规则采用[需求规格](user-web-requirements.md)。
2. 实施者按[开发文档索引](../../development-index.md)阅读接口与客户端资料，再按附录 D.2 指定的功能依据核对调用路径。
3. Web 尺寸使用 CSS 像素，变量映射为 CSS Custom Properties。动效参数采用视觉变量配置；框架与依赖采用产品背景第 2 节。
4. 两端共享业务数据、归属和会话规则；布局与输入差异采用组件规范第 6 节。角色 Runtime 和宿主的职责采用需求规格第 4 节。

<!-- expand:../../../apps/user-web/CONTEXT.md -->
<!-- expand:user-web-requirements.md -->

### D.2 接入状态与验收依据

1. 当前原型使用本机模拟账号、业务数据与生成结果，角色内容通过实际 Runtime 渲染。
2. 用户 Web 的接口消费路径见[功能依据第 2 节](feature-basis.md#2-功能与数据来源)，启动条件与真实浏览器结果见[实现验收](implementation-acceptance.md)。
3. 原型的浏览器验证范围采用原型验收第 2.2 节；用户 Web 按[页面交互规格](phase4-page-specs/README.md)中各页面第 9 节验收实际数据与交互。

<!-- expand:feature-basis.md -->

### D.3 阅读版生成

1. 在仓库根目录运行下列命令。生成器读取本文引用的来源文件，输出包含流程图的 HTML 阅读版。
2. [生成器](phase8-build.mjs)使用仓库已有的 Markdown、Mermaid 和本机 Playwright；`NODE_PATH` 指向已安装的 Playwright 模块目录。

```sh
NODE_PATH=/Users/developer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node docs/ixd/user-web/phase8-build.mjs
```

## 附录 E 页面覆盖

1. 第四章覆盖 P01—P22，共 22 项；其中 7 组页面分别提供桌面与手机布局，8 项页面或弹层由双端共用。
2. 22 类页面的适用性见信息架构第 6 节；原型完成情况见原型验收第 8 节。

## 附录 F 键盘操作

1. macOS、Windows 与手机外接键盘的操作规则见下表。

| 使用位置与动作 | 规则来源 |
| --- | --- |
| 顺序移动焦点 | 组件规范第 6.3 节 |
| 桌面消息输入：发送与换行 | P17 第 4.2 节 |
| 消息编辑：保存与取消 | P17 第 4.3 节 |
| 消息菜单：选择、执行与关闭 | P17 第 4.1 节 |
| 手机外接键盘：发送与换行 | P18 第 4 节 |
| 演绎设置：提交标题 | P19 第 4 节 |
| 删除弹层：焦点循环与关闭 | P21 第 8 节 |
