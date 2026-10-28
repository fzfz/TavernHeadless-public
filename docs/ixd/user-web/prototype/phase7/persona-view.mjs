import { escape } from "./components.mjs";
export const personaAction = (label, action, extra = "") =>
  `<button class="uw-button" type="button" data-persona="${action}" ${extra}>${label}</button>`;
export function personaList({
  items,
  total,
  defaultPersona,
  defaultName,
  loading,
  error,
  defaultError,
  offline,
  operation,
}) {
  return `<header class="uw-page-heading"><div><p class="uw-meta">当前账号的人物资料</p><h1>演绎人格</h1></div><a class="uw-button uw-primary" href="#personas/new">创建人格</a></header><p class="uw-meta">你可以创建多个人格，并在开始演绎时选择其中一个。</p><div class="uw-persona-default" role="status">${loading ? "正在读取默认人格…" : defaultError ? `默认人格读取失败。${personaAction("重新读取默认人格", "retry-default")}` : defaultName ? `当前默认：${escape(defaultName)}` : "尚未设置默认人格"}</div><p class="uw-form-feedback" id="persona-feedback" role="status" aria-live="polite">${offline ? "当前离线，可阅读已保存资料；连接网络后可保存更改。" : loading ? "正在读取人格…" : ""}</p><div id="persona-recovery">${operation ? personaAction(operation.kind === "delete" ? "核对删除结果" : "核对默认选择", "verify") : ""}</div><ul class="uw-persona-list">${items.map((p) => `<li><article class="uw-persona-card" data-persona-card="${p.id}"><header><h2 id="persona-${p.id}" tabindex="-1">${escape(p.name)}</h2>${!defaultError && p.id === defaultPersona ? '<span class="uw-persona-badge">默认人格</span>' : ""}</header><p class="uw-persona-summary">${escape(p.description)}</p><div class="uw-form-actions"><a class="uw-link" href="#personas/edit/${p.id}" aria-label="查看与编辑${escape(p.name)}">查看与编辑</a>${p.id === defaultPersona && !defaultError ? "" : personaAction("设为默认", "default", `data-id="${p.id}" aria-label="将${escape(p.name)}设为默认" ${offline || defaultError || operation ? "disabled" : ""}`)}${personaAction("删除", "delete", `data-id="${p.id}" aria-label="删除${escape(p.name)}" ${offline || operation ? "disabled" : ""}`)}</div><p class="uw-form-feedback" data-persona-feedback="${p.id}" role="status">${operation?.target === p.id ? (operation.kind === "delete" ? "删除结果待核对" : "默认选择待核对") : ""}</p></article></li>`).join("")}</ul>${!items.length && !loading && !error ? '<div class="uw-empty"><h2>创建你的第一个演绎人格</h2><p>为故事中的自己起一个名字，写下完整的人物资料。</p><a class="uw-button uw-primary" href="#personas/new">创建人格</a></div>' : ""}<div class="uw-pagination">${error ? `<p role="alert">${items.length ? "更多人格读取失败，已显示的人格仍可查看。" : "人格读取失败，请重试。"}</p>${personaAction("重试读取", "retry-list")}` : items.length < total ? personaAction(loading ? "正在加载…" : "加载更多", "more", loading ? "disabled" : "") : ""}</div>`;
}

export function personaEditorView({
  mode,
  values,
  fields,
  back,
  backLabel,
  notice,
  loading,
  missing,
  failed,
  canRead,
}) {
  const title = mode === "create" ? "创建演绎人格" : "编辑演绎人格";
  return `<div class="uw-persona-form-width"><a class="uw-link uw-persona-back" href="#${escape(back)}">${backLabel}</a><header class="uw-page-heading"><h1>${title}</h1></header>${mode === "edit" ? '<p class="uw-meta">修改后的资料用于之后开始的演绎。</p>' : ""}<div id="persona-draft-notice" role="status">${notice || ""}</div>${
    missing
      ? '<div class="uw-empty"><h2>无法访问这个人格</h2><p>该人格可能已被删除，或属于其他账号。请返回你的人格列表。</p></div>'
      : loading && !canRead
        ? '<p role="status">正在读取人格资料…</p>'
        : failed && !canRead
          ? `<p role="alert">人格资料读取失败，请重新读取。</p>${personaAction("重新读取人格", "reload")}`
          : `${failed ? `<p role="alert">人格资料读取失败，当前显示上次读取的资料。</p>${personaAction("重新读取人格", "reload")}` : ""}<div id="persona-conflict"></div><form id="persona-editor-form" class="uw-identity-form" novalidate>${Object.entries(
              fields,
            )
              .map(
                ([name, spec]) =>
                  `<div class="uw-field"><label for="persona-field-${name}">${spec.label}</label><div class="uw-field-input">${name === "description" ? `<textarea id="persona-field-${name}" name="${name}" rows="5" required maxlength="${spec.maxLength}" aria-describedby="persona-${name}-hint persona-${name}-error">${escape(values[name])}</textarea>` : `<input id="persona-field-${name}" name="${name}" value="${escape(values[name])}" required maxlength="${spec.maxLength}" autocomplete="off" aria-describedby="persona-${name}-hint persona-${name}-error">`}</div><p class="uw-meta" id="persona-${name}-hint">${spec.hint}</p><p class="uw-field-error" id="persona-${name}-error"></p></div>`,
              )
              .join(
                "",
              )}<p id="persona-editor-feedback" class="uw-form-feedback" role="status" aria-live="polite"></p><div id="persona-editor-recovery"></div><div class="uw-form-actions"><a class="uw-button" href="#${escape(back)}">取消</a><button class="uw-button uw-primary" type="submit">${mode === "create" ? "保存人格" : "保存修改"}</button></div><p class="uw-meta">Ctrl + Enter 或 ⌘ + Enter 保存；描述中的 Enter 换行。</p></form>`
  }</div>`;
}
