# 设计依据

主 Agent 核对的代码基线为 `9acccbb`。`packages/adapters-sillytavern/src/role-migrations/` 已包含独立转换函数；`apps/api/src/routes/imports.ts` 的角色导入路由按 `role_migration` 参数调用 `services/role-runtime/role-import-service.ts`。现有迁移需要明确的条目和规则配置，正式管理端普通导入未提供该参数。

原有 MVU 职责设计要求把剧情知识、初始化、变量规则、控制器和旧协议分开，见 `docs/plans/mvu-worldbook-responsibilities.md`。本提案需将这些职责表达为可导出、可重导入的角色交付格式。

外部规范入口：<https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md>；<https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md>。主 Agent 仅将其作为格式资料。

代码定位进一步确认：`apps/api/src/routes/exports.ts` 的角色导出只输出 ST JSON；`role-releases.ts` 固定资源引用，`role-assets.ts` 提供版本文件读取，三者尚未组成完整交付包。设计因此要求按固定版本归集全部依赖，并在空库验证往返等价。

独立审阅后，草案补齐现有世界书的八种插入位置、辅助关键词否定逻辑、条目级扫描/全词匹配和递归参数；状态字段采用唯一写入者；转换草稿与正式卡使用不同标识；来源更新操作使旧报告与确认失效。能力矩阵的 `verified` 当前均为 false，表示这些是待实施和验收的范围。
