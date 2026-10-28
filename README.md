---
文档用途: 介绍 TavernHeadless，并提供开发与接口文档入口。
读取时机: 首次了解仓库或准备本机运行时读取。
---

# TavernHeadless

面向开发者的 AI 角色扮演（RP）后端引擎。Headless 架构，SillyTavern 资产兼容，TypeScript 全栈。

## 项目职责

1. TavernHeadless 通过 REST API 提供会话、楼层、消息、变量、记忆、提示词编排和工具调用能力。客户端通过接口接入这些能力。
2. 已有的 SillyTavern 资产（预设、世界书、正则、角色卡）可以直接导入使用。

## 核心概念

1. **会话 → 楼层 → 消息页**：三层结构，支持分支和重新生成。
1. **变量作用域**：全局、会话、分支、楼层和页级；读写规则见[变量系统](docs/architecture.md#3-变量系统)。
1. **提示词编排**：兼容酒馆拼接模式，也支持原生图编译，统一输出 [Prompt IR](docs/architecture.md#统一中间格式prompt-ir)。
1. **记忆系统**：自动提取摘要，结构化存储，后台异步维护。
1. **工具调用 & MCP**：内置工具 + 自定义工具，支持原生 function
   calling 与文本协议回退，并支持 MCP 服务器集成。
1. **官方 SDK**：`@tavern/sdk` +
   `@tavern/client-helpers`，TypeScript 类型化接入。

## 快速开始

1. 按[软件与依赖准备](docs/environment-operations.md#2-软件与依赖准备)安装固定软件和依赖。
2. 按[首次初始化与配置](docs/environment-operations.md#3-首次初始化与配置)准备开发环境和数据库。
3. 按[手动进程操作](docs/environment-operations.md#4-手动进程操作)启动服务。
4. 按手册第 4 节的浏览器地址规则访问管理 Web、用户 Web 或 Studio。

## 文档

1. 在线文档站：**[hersophia.github.io/TavernHeadless](https://hersophia.github.io/TavernHeadless/)**。
2. 专题文档：

   | 文档                            | 说明                         |
   | ------------------------------- | ---------------------------- |
   | [简介 & 快速开始][introduction] | 了解项目、跑起来             |
   | [架构设计][architecture]        | 系统架构、核心概念、数据模型 |
   | [API 参考][api-reference]       | 所有 REST 接口               |
   | [SDK 文档][sdk-docs]            | 官方接入指南                 |
   | [协作指南][contributing-guide]  | 参与开发需要知道的规则       |

3. 仓库内设计文档位于 `docs/`，包含架构、数据库字典、测试与 CI 规范。

[introduction]: https://hersophia.github.io/TavernHeadless/guide/introduction
[architecture]: https://hersophia.github.io/TavernHeadless/guide/architecture
[api-reference]: https://hersophia.github.io/TavernHeadless/reference/api
[sdk-docs]: https://hersophia.github.io/TavernHeadless/sdk/
[contributing-guide]: https://hersophia.github.io/TavernHeadless/development/contributing

## 技术栈

| 层级           | 技术                        |
| -------------- | --------------------------- |
| 后端框架       | Fastify                     |
| 语言           | TypeScript                  |
| 数据库         | SQLite + Drizzle ORM        |
| LLM 接入       | Vercel AI SDK               |
| 前端（管理台） | Vue 3 + Pinia + TailwindCSS |
| 包管理         | pnpm (monorepo)             |

## 前端（开发中）

1. `apps/web` 提供管理界面。
2. `apps/user-web` 提供角色浏览、用户登录和演绎界面。
3. `apps/studio` 提供以 NodeGraph 编辑器为核心的实验前端。
4. 各前端依赖版本见对应的 `package.json`。

## 许可证

MIT
