import { escape } from "./components.mjs";
import fields from "./session-fields.json" with { type: "json" };

export const historyScenarios = [
  ["normal", "正常"], ["slow", "慢速读取与保存"],
  ["failure", "历史读取失败"], ["append-failure", "追加读取失败"],
  ["write-failure", "重命名或删除失败"], ["partial", "批量删除部分完成"],
  ["unknown", "写入结果待确认"], ["check-failure", "写入结果读取失败"],
  ["offline", "离线"], ["empty", "历史为空"],
];

export function historyAction(label, action, options = {}) {
  const { id = "", disabled = false, danger = false, extra = "" } = options;
  return `<button type="button" class="uw-button ${danger ? "uw-danger" : ""}" data-history="${action}" data-id="${escape(id)}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`;
}

function titleEditor(item, draft, operation, index, offline) {
  const pending = operation?.kind === "rename" && operation.id === item.id;
  return `<form data-history-form="rename" data-id="${escape(item.id)}" class="uw-history-editor">
    <label for="history-title-${index}">${escape(fields.title.label)}</label>
    <input id="history-title-${index}" name="title" maxlength="${fields.title.maxLength}" value="${escape(draft.title)}" ${pending ? "disabled" : ""} aria-describedby="history-title-help-${index}${draft.error ? ` history-title-error-${index}` : ""}" ${draft.error ? 'aria-invalid="true"' : ""}>
    <p class="uw-meta" id="history-title-help-${index}">标题最多 ${fields.title.maxLength} 个字符。</p>
    ${draft.conflict ? `<div class="uw-history-conflict" role="status"><p>保存的标题已变化，请核对后继续。</p><p>当前保存的标题：${escape(draft.saved)}</p><p>本地草稿：${escape(draft.title)}</p><div class="uw-history-actions">${historyAction("使用草稿继续编辑", "keep-draft", { id: item.id })}${historyAction("采用已保存标题", "use-saved", { id: item.id })}</div></div>` : ""}
    ${draft.error ? `<p class="uw-field-error" role="alert" id="history-title-error-${index}">${escape(draft.error)}</p>` : ""}
    <div class="uw-history-actions"><button class="uw-button uw-primary" type="submit" ${pending || draft.conflict || offline ? "disabled" : ""}>${pending ? operation.status === "saving" ? "正在保存…" : "等待核对" : "保存标题"}</button>${historyAction("取消重命名", "cancel-rename", { id: item.id, disabled: pending })}${pending && operation.status !== "saving" ? historyAction("核对重命名结果", "verify") : ""}</div>
  </form>`;
}

export function historyList({ items, total, loaded, query, searchDraft, selected, managed, mobile, loading, error, failedMore, offline, feedback, editor, drafts, operation, menu, running }) {
  const eligible = items.filter((item) => !running(item.id));
  const allSelected = eligible.length > 0 && eligible.every((item) => selected.has(item.id));
  const busy = operation && (operation.kind === "rename" || operation.status !== "review");
  return `<section class="uw-history" aria-labelledby="history-heading">
    <div class="uw-page-heading"><div><h1 id="history-heading" tabindex="-1">历史演绎</h1></div><a class="uw-button uw-primary" href="#discover">开始新演绎</a></div>
    <form class="uw-history-search" data-history-form="search"><div class="uw-field"><label for="history-search">搜索演绎记录</label><input id="history-search" name="search" type="search" value="${escape(searchDraft)}" placeholder="搜索标题、角色或人格"></div><div class="uw-history-actions"><button class="uw-button" type="submit">搜索</button>${historyAction("清除", "clear-search")}</div></form>
    <p class="uw-meta" data-history-condition>${query ? `当前搜索：${escape(query)}` : "当前显示全部演绎记录"} · 已加载 ${items.length} 条${total !== null ? `，共 ${total} 条` : ""}</p>
    ${offline ? '<p class="uw-feedback" role="status">当前处于离线状态，已读取的记录可继续查看。恢复连接后请重新读取并核对操作结果。</p>' : ""}
    ${mobile ? historyAction(managed ? "完成" : "管理记录", "manage", { extra: `aria-expanded="${managed}" aria-controls="history-selection"` }) : ""}
    ${!mobile || managed ? `<div class="uw-history-selection" id="history-selection"><label class="uw-history-check"><input type="checkbox" data-history-select="loaded" ${allSelected ? "checked" : ""} ${eligible.length === 0 ? "disabled" : ""}><span>选择已加载记录（${eligible.length} 条可选）</span></label><p role="status">已选 ${selected.size} 条</p>${historyAction("删除所选", "delete-selected", { danger: true, disabled: selected.size === 0 || offline || !!busy })}</div>` : ""}
    <div id="history-feedback" class="uw-feedback" role="status" aria-live="polite">${escape(feedback)}</div>
    ${operation?.kind === "delete" && operation.status !== "review" ? `<div class="uw-history-pending"><p>${operation.status === "saving" ? "正在删除演绎…" : "部分演绎的删除尚未完成，请查看删除结果。"}</p>${historyAction("查看删除结果", "show-delete")}${Object.values(operation.outcomes).some((v) => v === "unknown") ? historyAction("核对删除结果", "verify", { disabled: offline }) : ""}</div>` : ""}
    ${loading ? '<p role="status">正在读取演绎记录…</p>' : ""}
    ${error ? `<div class="uw-history-read-error" role="alert"><p>${failedMore ? "更多记录读取失败，已加载的记录仍可使用。" : "演绎记录读取失败，请重试。"}</p>${historyAction(failedMore ? "重试加载更多" : "重新读取", "retry-read", { disabled: offline })}</div>` : ""}
    <ol class="uw-history-list">${items.map((item, index) => `<li class="uw-history-row" data-history-row="${escape(item.id)}" tabindex="-1">
      ${!mobile || managed ? `<label class="uw-history-check uw-history-item-check"><input type="checkbox" data-history-select="item" data-id="${escape(item.id)}" aria-label="选择演绎：${escape(item.title)}" ${selected.has(item.id) ? "checked" : ""} ${running(item.id) ? "disabled" : ""}><span>选择</span></label>` : ""}
      <div class="uw-history-copy"><h2><a class="uw-link" href="#chat/${encodeURIComponent(item.id)}" data-history-continue="${escape(item.id)}">${escape(item.title)}</a></h2><p class="uw-meta">角色：${escape(item.characterName)} · 人格：${escape(item.persona?.name || "未提供人格姓名")}</p><time class="uw-meta" datetime="${escape(item.updatedAt)}" title="${escape(item.fullTime)}">${escape(item.fullTime)}</time>
      ${running(item.id) ? '<p class="uw-meta">演绎正在生成，请结束后再删除。</p>' : ""}
      ${editor === item.id && drafts[item.id] ? titleEditor(item, drafts[item.id], operation, index, offline) : ""}</div>
      <div class="uw-history-row-actions"><a class="uw-button" href="#chat/${encodeURIComponent(item.id)}" data-history-continue="${escape(item.id)}">继续演绎</a><div class="uw-history-menu-wrap">${historyAction("更多", "menu", { id: item.id, extra: `aria-label="更多：${escape(item.title)}" aria-haspopup="menu" aria-expanded="${menu === item.id}"` })}${menu === item.id ? `<div role="menu" class="uw-history-menu" aria-label="${escape(item.title)}的操作"><button type="button" role="menuitem" data-history="rename" data-id="${escape(item.id)}" ${busy ? "disabled" : ""}>重命名</button><button type="button" role="menuitem" data-history="delete" data-id="${escape(item.id)}" ${running(item.id) || busy || offline || editor === item.id ? "disabled" : ""}>删除演绎</button></div>` : ""}</div></div>
    </li>`).join("")}</ol>
    ${!loading && !error && !items.length ? `<div class="uw-empty"><h2>${query ? "没有匹配的演绎记录" : "还没有演绎记录"}</h2><p>${query ? "请修改关键词，或清除搜索条件。" : "选择喜欢的角色，开始你的第一段故事。"}</p>${query ? historyAction("清除搜索条件", "clear-search") : '<a class="uw-button uw-primary" href="#discover">前往角色广场</a>'}</div>` : ""}
    ${!loading && !error && total !== null && loaded < total ? historyAction("加载更多演绎", "more") : ""}
    ${items.length && !loading ? historyAction("刷新演绎记录", "refresh", { disabled: offline }) : ""}
  </section>`;
}

const resultText = {
  review: "等待确认", saving: "正在删除…", deleted: "已删除", missing: "已不存在",
  running: "正在生成，暂时无法删除", failed: "删除失败，可重试", unknown: "结果待确认", retained: "尚未删除，可重试",
};

export function historyDeleteView(operation, offline) {
  const first = operation.status === "review", single = operation.targets.length === 1;
  const unknown = Object.values(operation.outcomes).includes("unknown");
  const deleted = Object.values(operation.outcomes).filter((v) => v === "deleted").length;
  const missing = Object.values(operation.outcomes).filter((v) => v === "missing").length;
  const done = deleted + missing;
  const retry = operation.targets.some((t) => ["failed", "retained", "running"].includes(operation.outcomes[t.id]));
  return `<section class="uw-account-dialog uw-history-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="history-delete-title" aria-describedby="history-delete-impact" data-page-id="P21">
    <h2 id="history-delete-title">${single ? "删除演绎？" : `删除所选的 ${operation.targets.length} 条演绎？`}</h2>
    <div class="uw-dialog-copy"><p id="history-delete-impact">删除后无法继续此演绎。</p>
    <ol class="uw-history-delete-targets">${operation.targets.map((t) => `<li><strong>${escape(t.title)}</strong><p class="uw-meta">角色：${escape(t.characterName)} · 人格：${escape(t.persona?.name || "未提供人格姓名")}</p><p data-history-result="${escape(t.id)}">${resultText[operation.outcomes[t.id]] || "等待确认"}</p></li>`).join("")}</ol>
    <p role="status" aria-live="polite">${first ? "请核对以上删除对象。" : `已删除 ${deleted} 条，${missing} 条已不存在，剩余 ${operation.targets.length - done} 条。`}</p>${offline ? '<p role="status">当前处于离线状态，请恢复连接后核对目标。</p>' : ""}</div>
    <div class="uw-dialog-actions">${historyAction(first ? "取消" : "返回列表", "close-delete")}
    ${first ? historyAction(single ? "删除演绎" : "删除所选演绎", "confirm-delete", { danger: true, disabled: offline }) : ""}
    ${unknown ? historyAction("核对结果", "verify", { disabled: offline }) : ""}
    ${retry && !unknown ? historyAction("重试剩余项", "retry-delete", { danger: true, disabled: offline }) : ""}</div>
  </section>`;
}
