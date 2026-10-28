# 两端方案与原型交付计划

## 必须要实现的目标

主 Agent 产出 `docs/plans/role-app-dual-web-plan.md`，以可视纵向流程拆分实施步骤。
主 Agent 使用 prototype 技能分别产出管理端和用户端原型。
管理端文件为 `apps/web/prototypes/admin-workspace.prototype.html`。
用户端文件为 `apps/user-web/prototypes/user-roleplay.prototype.html`。

主 Agent 根据后端源码产出管理端编辑边界与资源生命周期设计，并同步修订两端方案；后续原型修改采用该设计。

## 验收清单

- 方案第一步包含可交互原型，后续每步包含两端操作、后端结果、异常及完成条件。
- 主 Agent 完成文档检查；独立 Agent 审阅方案和原型文案，主 Agent 处理意见。
- 主 Agent 将原型保存在独立原型分支，并报告人工交互验收状态。

## 非本次目标

本轮仅生成方案与一次性原型；正式功能、依赖安装和后台服务启动属于后续实施。

## 已获得的授权

用户授权设计两端同步联调方案，并使用 prototype 技能设计第一步原型。
