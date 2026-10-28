# Domain docs

ADR 指架构决策记录。

## 文档布局

根目录 `CONTEXT-MAP.md` 必须索引各领域的 `CONTEXT.md`。

跨领域架构决策必须存放在根目录 `docs/adr/`。模块领域文档必须存放在对应模块根目录的 `CONTEXT.md`，模块架构决策必须存放在该模块的 `docs/adr/`。

模块根目录包括 `apps/<模块>/`、`packages/<模块>/` 和
`packages/official-integration-kit/<模块>/`。
Agent 必须根据已确认的领域边界维护索引条目。

## 阅读顺序

Agent 探索代码前必须先阅读已有的根目录 `CONTEXT-MAP.md`，再阅读其中与任务相关的领域文档，以及根目录和相关模块的 ADR。

文档尚未建立时，Agent 必须继续检查代码中的领域证据。
术语或决策确定后，Agent 必须使用 `domain-modeling` Skill 创建或更新对应文档，
并在文档索引条目发生变化时更新索引。

## 术语与决策

Agent 在 Issue、方案、假设和测试名称中使用领域概念时，必须采用相关 `CONTEXT.md` 定义的术语。

Agent 发现术语缺口时，必须在任务反馈中列出缺失概念和所属模块；术语确定后的文档更新必须遵循“阅读顺序”中的要求。

Agent 提出与现有 ADR 冲突的方案时，必须明确指出 ADR 路径、冲突内容和重新讨论的理由。
