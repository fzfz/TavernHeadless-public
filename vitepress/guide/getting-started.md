---
文档用途: "说明本机原生环境的准备顺序，并提供仓库操作手册入口。"
读取时机: "首次安装或启动 TavernHeadless 时读取。"
---

# 快速开始

## 1. 准备环境

1. 从仓库根 `package.json` 读取 Node.js 与 pnpm 固定版本。
2. 从 `config/environments.json` 读取 Nginx 版本和三环境配置。
3. 按仓库 `docs/environment-operations.md` 的安装授权与初始化步骤准备 dev。
4. 填写 dev 的认证与业务配置，并按操作手册显式迁移数据库。
5. 按根 `AGENTS.md` 的“三环境目录约定”保存配置与运行数据。

## 2. 启动与停止

1. 在 dev 根目录执行 `node scripts/environments/cli.mjs start --env dev`。
2. 执行 `node scripts/environments/cli.mjs status --env dev`，确认进程与入口健康。
3. 从环境配置读取管理 Web、用户 Web 和 Studio 的浏览器入口，并打开页面。
4. 使用结束后，执行 `node scripts/environments/cli.mjs stop --env dev`。
5. 执行 `node scripts/environments/cli.mjs <command> --help` 查看参数。

## 3. 发布与故障处理

1. 构建、staging 验收、prod 发布、应用回退和数据库恢复均按
   `docs/environment-operations.md` 执行。
2. 每条命令返回结果文件路径；从该文件定位失败阶段和日志。
3. API 配置语义以 `apps/api/src/config.ts` 为准；接口调用方式见
   [API 参考](../reference/api)。
