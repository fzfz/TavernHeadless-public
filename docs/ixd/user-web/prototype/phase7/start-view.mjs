import { escape, nav } from "./components.mjs";
import { icon } from "../icons.mjs";

const action = (label, id, disabled = false, primary = false) => `<button type="button" class="uw-button ${primary ? "uw-primary" : ""}" data-start="${id}" ${disabled ? "disabled" : ""}>${label}</button>`;
const readable = (text) => `<div class="uw-start-prose">${escape(text).split(/\n\s*\n/).map((p) => `<p>${p}</p>`).join("")}</div>`;
const feedback = (text, retry) => `<div class="uw-start-feedback" role="status"><p>${text}</p>${retry ? action("重新读取", retry) : ""}</div>`;

function personaGroup(s) {
  const busy = !!s.operation, selected = s.items.find((p) => p.id === s.personaId);
  return `<section class="uw-start-panel"><fieldset id="start-personas" tabindex="-1" aria-describedby="start-persona-status"><legend>演绎人格</legend>
    <div id="start-persona-status">${s.personaStatus === "loading" ? feedback("正在读取演绎人格…") : ""}${s.personaStatus === "error" ? feedback("演绎人格读取失败，已读取的内容仍可查看。", "retry-personas") : ""}${s.personaStatus === "ready" && !s.total ? feedback("先创建一个演绎人格") : ""}${s.stalePersona ? feedback(escape(s.stalePersona) + "已失效或资料已变化，请重新选择本次人格。") : ""}</div>
    <div class="uw-start-options">${s.items.map((p) => `<label class="uw-start-option ${p.id === s.personaId ? "is-selected" : ""}"><input type="radio" name="start-persona" value="${escape(p.id)}" aria-label="${escape(p.name)}" ${p.id === s.personaId ? "checked" : ""} ${busy || s.personaStatus !== "ready" ? "disabled" : ""}><span><strong>${escape(p.name)}</strong>${p.id === s.defaultPersona ? '<span class="uw-meta"> · 默认人格</span>' : ""}<span class="uw-start-excerpt">${escape(p.description)}</span></span></label>`).join("")}</div>
    ${s.total ? `<p class="uw-meta">已加载 ${s.items.length} / ${s.total} 个人格</p>` : ""}
    ${s.loaded < s.total ? action(s.moreLoading ? "正在加载人格…" : "加载更多人格", "more", busy || s.moreLoading) : ""}
    ${s.moreError ? feedback("更多人格读取失败，当前选择已保留。", "retry-more") : ""}
    ${!busy ? `<a class="uw-link" href="#personas/new?from=${encodeURIComponent(s.route)}&opening=${s.opening ?? 0}">创建人格</a>` : ""}
    ${selected ? `<section class="uw-start-description" aria-label="所选人格完整描述"><h2>${escape(selected.name)}</h2>${readable(selected.description)}</section>` : '<p class="uw-meta">请选择本次演绎人格。</p>'}
  </fieldset></section>`;
}

function openingGroup(s) {
  return `<section class="uw-start-panel"><fieldset id="start-openings" tabindex="-1" aria-describedby="start-opening-status"><legend>角色开场</legend>
    <div id="start-opening-status">${s.roleStatus === "loading" ? feedback("正在读取角色与开场…") : ""}${s.roleStatus === "error" ? feedback("角色与开场读取失败。", "retry-role") : ""}${s.roleStatus === "ready" && !s.openings.length ? feedback("这个角色暂时没有可用开场，请重新读取或返回角色。", "retry-role") : ""}${s.staleOpening ? feedback("所选开场已变化，请重新选择本次开场。") : ""}</div>
    <div class="uw-start-options">${s.openings.map((text, i) => `<label class="uw-start-option ${i === s.opening ? "is-selected" : ""}"><input type="radio" name="start-opening" value="${i}" aria-label="开场 ${i + 1}" ${i === s.opening ? "checked" : ""} ${s.operation || s.roleStatus !== "ready" ? "disabled" : ""}><span><strong>开场 ${i + 1}</strong><span class="uw-start-excerpt">${escape(text)}</span></span></label>`).join("")}</div>
  </fieldset>
  ${s.opening !== null && s.openings[s.opening] ? `<section class="uw-start-preview" aria-label="所选开场预览"><h2>开场 ${s.opening + 1} · 正文预览</h2>${s.previewStatus === "loading" ? feedback("正在读取开场正文…") : s.previewStatus === "error" ? feedback("开场正文读取失败。", "retry-preview") : `<div id="start-opening-preview" class="${s.expanded ? "" : "uw-start-preview-collapsed"}">${readable(s.openings[s.opening])}</div>${action(s.expanded ? "收起开场全文" : "展开开场全文", "expand")}`}</section>` : ""}
  </section>`;
}

export function startView(s, platform) {
  const selected = s.items.find((p) => p.id === s.personaId), backLabel = s.source.startsWith("detail/") ? "返回角色详情" : "返回角色广场";
  const content = `<div class="uw-start-heading">${platform === "desktop" ? `<a class="uw-link" href="#${escape(s.source)}">${icon("left")}${backLabel}</a>` : ""}<h1>开始演绎</h1></div>
    ${s.card ? `<section class="uw-start-character"><div><p class="uw-meta">${escape(s.card.subtitle)}</p><h2>${escape(s.card.name)}</h2><p>${escape(s.card.description)}</p></div></section>` : ""}
    <div class="uw-start-columns">${personaGroup(s)}${openingGroup(s)}</div>
    <section class="uw-start-submit" aria-label="确认本次选择"><div><h2>本次选择</h2><p>${escape(s.card?.name || "角色读取中")} · ${escape(selected?.name || "请选择人格")} · ${s.opening === null ? "请选择开场" : `开场 ${s.opening + 1}`}</p></div><div class="uw-start-submit-actions"><p id="start-feedback" role="status" aria-live="polite">${escape(s.notice || s.reason)}</p>${s.operation?.status === "created" ? action("重新打开演绎", "reopen", s.offline, true) : `${action(s.operation?.status === "submitting" ? "正在创建演绎…" : "开始演绎", "create", !!s.reason || !!s.operation, true)}${s.operation && s.operation.status !== "submitting" ? action("核对创建结果", "verify", s.verifying) + '<a class="uw-link" href="#history">返回历史</a>' : ""}`}</div></section>`;
  if (platform === "mobile") return `<div class="uw-mobile uw-start-page" data-page-id="P14"><header class="uw-mobile-header"><a class="uw-link" href="#${escape(s.source)}">${icon("left")}${backLabel}</a><span>开始演绎</span></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main></div>`;
  return `<div class="uw-desktop uw-start-page" data-page-id="P13"><aside class="uw-sidebar"><a class="uw-brand" href="#discover">${icon("book")}<strong>Tavern.</strong></a><p class="uw-meta">角色演绎</p>${nav("discover")}</aside><div class="uw-workspace"><header class="uw-desktop-header"><p class="uw-meta">Tavern / <strong>开始演绎</strong></p></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main></div></div>`;
}
