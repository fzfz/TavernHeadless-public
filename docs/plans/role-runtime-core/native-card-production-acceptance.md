# 角色卡正式实现验收记录

2026-09-29，原生 ZIP 的上传、校验、持久编辑、固定版本发布、会话运行、打包下载和独立环境再导入链路已通过验收。正式管理端使用官方 SDK、API、SQLite 和文件存储；模型响应来自本机受控 HTTP 服务，并经过正式 SSE 链路。后续用户授权 OpenRouter 免费模型验收，实际完成 15 次调用；真实链路已连通，模型语义及部分供应商调用未全部通过，详见[外部模型验收](native-card-openrouter-acceptance.md)。

## 页面与启动

当前角色卡编辑器入口为 `/character-editor`，管理端入口替换的后续纠正见[角色卡编辑入口统一](character-card-unified-entry.md)。下述端口和证据记录首次技术链路验收时的环境。首次验收的编辑器位于 `http://127.0.0.1:5195/native-card-editor`，API 位于 `http://127.0.0.1:3041`，用户端位于 `http://localhost:5174`。从仓库根目录分别运行：

```sh
pnpm --filter @tavern/api exec tsx scripts/native-card-acceptance.ts
```

```sh
VITE_API_BASE_URL=http://127.0.0.1:3041 pnpm --filter @tavern/web dev --host 127.0.0.1 --port 5195
```

```sh
NATIVE_CARD_ACCEPTANCE_PUBLIC_DIR="$PWD/.planning/native-card-production/evidence/instance-a/user-web-public" pnpm --filter @tavern/user-web exec vite --config vite.native-card-acceptance.config.ts --host localhost --port 5174
```

验收 API 程序读取 `apps/api/test/fixtures/native-card/acceptance-config.json`，创建隔离数据及本机受控供应商。已有进程占用这些端口时，执行者先核对其启动参数并复用对应验收进程。生产部署的配置与启动方法见[安装说明](../../../vitepress/guide/getting-started.md)。完整作者示例见[雾港来信](native-card-io.md#完整角色示例)。

## I01–I15

下表中的证据路径相对于工作区 `.planning/native-card-production/evidence/`；截图、请求响应、ZIP 和日志保存在本次工作区，不随代码提交。

| 项目 | 结果 | 证据与覆盖范围 |
| --- | --- | --- |
| I01 管理端上传 | 通过 | `final-browser-checklist.json`、导入各阶段截图：真实上传、检查、确认、目录打开、失败重试与焦点。 |
| I02 解包 | 通过 | ZIP 单元及集成测试：最小/完整包、路径、重复项、压缩及上传限制、损坏文件。 |
| I03 清单 | 通过 | 共享 schema；`instance-b/pure-chat.json` 与完整包导入记录覆盖系统聊天和自定义前端。 |
| I04 人物 | 通过 | 实际表单保存和 `instance-c/latest-roundtrip.json` 中 dry-run 消息包含固定人物资料。 |
| I05 开场 | 通过 | 多开场、默认开场、初始变量和失败回滚测试；`instance-a/second-opening.json`。 |
| I06 世界书 | 通过 | 两书同 UID、跨书移动及引用；`instance-a/worldbook-disable-and-repeat-import.json` 与 dry-run 追踪。 |
| I07 控制器 | 通过 | `instance-c/dry-run.json` 的独立控制器展开，及模块错误定位测试。 |
| I08 变量 Agent | 通过 | `instance-c/provider-requests.jsonl`、运行截图与状态：专用模型配置经受控 HTTP/SSE 更新。 |
| I09 校验器与变量工具 | 通过 | 模块静态检查、隔离执行、derive/validate、提案检查与实际状态提交测试。 |
| I10 前端与媒体 | 通过 | `instance-c/resource-forms-browser.json`、截图和 `restart-after.json`：跨 origin 相对引用、数据 URL、固定资源及重启。 |
| I11 正则 | 通过 | 浏览器正文将两条正则依次作用于“蓝色印记”，最终显示“雾港邮政印记”。 |
| I12 系统配置 | 通过 | 系统预设、模型、供应商和凭据保留在系统；发布绑定及资源消费者保护测试通过。 |
| I13 编辑与版本 | 通过 | 文件操作、原子保存、并发冲突、未保存离开；`instance-a/version-pinning.json` 证明旧会话固定。 |
| I14 校验与完整性 | 通过 | `i14-parser-http.json` 的 15 项正式接口检查；浏览器错误定位；文件/数据库失败与进程中断恢复测试。 |
| I15 导出往返 | 通过 | 浏览器下载固定修订 ZIP；独立实例 C 的 `latest-roundtrip.json` 和 `restart-after.json` 确认 30 文件逐字节一致并可运行。 |

主 Agent 已阅读实际 dry-run 消息和浏览器正文：裴修远的完整人设与第三人称预设进入请求，历史开场和当前台词归属明确；沈知夏指出信封印记后与裴修远抵达花园门口，状态同步到该地点。更新器专用世界书条目按隔离规则退出正文，单独控制器在作者示例中展开地点。

## 视觉与交互

`final-visual-closure.md` 和 `final-browser-checklist.json` 记录逐项结论。桌面使用 1440×1000 视口，窄屏使用 390×844；Agent 阅读对应截图，脚本辅助测量确定尺寸。顶部工具栏、导航、各内容面板、文件树、保存栏、弹窗、滚动、焦点及禁用状态均完成对照。`prototype-final4-openings.png` 与 `formal-final4-openings.png` 确认正文框高度差已修复；导入确认表格的尺寸与行距见 `import-ready-geometry-final.json`。

页面显示真实编号、时间、修订、错误与预览结果。世界书跨书移动入口以及替代模拟选项的真实预览入口在视觉差异记录中单独列明。批准原型及相关八个文件保持原样，原型检查 47 项通过。

## 项目检查与审阅

独立提交候选采用自己的依赖安装、构建产物和数据目录。`candidate-final-*.json` 与同名日志记录命令、目录、退出码和用时：构建、类型检查、静态检查、SDK 生成与一致性检查通过；完整测试通过 542 个文件、4839 项测试。文档构建通过，结果由同目录 `candidate-final-docs.json` 记录。

代码规范与方案符合性已分别审阅，最终变更又经过独立正确性与提交前简化审阅。审阅发现的错误详情丢失、HTML 相对资源地址及导入字段定位问题均已修复；`final-correctness-closure.md` 未发现待修复的重大问题，作者 API 和模板文案的独立语义复核通过。

用户批准方案 B：提交原生角色卡实现以及必要的 P1–P3 历史分页、状态回看前置和相应契约、测试。原有其他工作及跨 P0–P7 的本地台账保留未提交。真实外部模型验证已执行，其通过项、失败样本和待解决问题见[外部模型验收](native-card-openrouter-acceptance.md)。
