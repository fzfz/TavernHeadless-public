# Issue tracker: GitHub

本仓库的问题和规格记录在 `fzfz/TavernHeadless` 的 GitHub Issues 中。

Agent 必须使用 `gh` CLI。
所有 `gh issue` 命令必须显式携带 `--repo fzfz/TavernHeadless`，
所有仓库 API 路径必须以 `repos/fzfz/TavernHeadless/` 开头。

## 操作约定

Agent 必须将以下命令的占位符替换为实际值。多行正文必须先保存为 UTF-8 文件，再通过 `--body-file` 传入。

- 创建：`gh issue create --repo fzfz/TavernHeadless --title '<标题>' --body-file '<正文文件>'`。
- 读取：`gh issue view <编号> --repo fzfz/TavernHeadless --json number,title,body,labels,comments,state,assignees`。
- 列表：Agent 必须按任务选择状态和标签过滤条件。

  ```sh
  gh issue list --repo fzfz/TavernHeadless --state open \
    --json number,title,body,labels,comments,assignees
  ```

- 评论：`gh issue comment <编号> --repo fzfz/TavernHeadless --body-file '<正文文件>'`。
- 添加标签：`gh issue edit <编号> --repo fzfz/TavernHeadless --add-label '<标签>'`。
- 移除标签：`gh issue edit <编号> --repo fzfz/TavernHeadless --remove-label '<标签>'`。
- 关闭：`gh issue close <编号> --repo fzfz/TavernHeadless`。

Skill 要求“publish to the issue tracker”时，Agent 必须执行创建操作；
要求“fetch the relevant ticket”时，Agent 必须执行读取操作。

Agent 执行外部写入时必须依据用户已有授权。

## Triage 范围

Agent 必须将 triage 队列限定为 Issues。

## Wayfinder

Wayfinder 的 map 是承载 Notes、Decisions-so-far 和 Fog 的总览 Issue，
child ticket 是对应工作项的子 Issue。

Agent 必须为 map 设置 `wayfinder:map` 标签，
为 child ticket 按类型设置 `wayfinder:research`、`wayfinder:prototype`、
`wayfinder:grilling` 或 `wayfinder:task` 标签，
并使用 GitHub sub-issues 关联二者。

Agent 必须使用 GitHub 原生 issue dependencies 记录阻塞关系，使用阻塞 Issue 的数据库 `id` 作为 `issue_id`。

Agent 必须按 map 顺序选择所有阻塞项均已关闭且尚未分配负责人的开放子 Issue，
并通过 `gh issue edit <编号> --repo fzfz/TavernHeadless --add-assignee @me` 领取任务。

Agent 完成子 Issue 后必须依次发表评论、关闭该 Issue，并将结论摘要和链接写入 map 的 Decisions-so-far。
