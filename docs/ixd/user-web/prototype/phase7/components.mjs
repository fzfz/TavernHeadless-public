import { icon } from "../icons.mjs";
import { config } from "../data.mjs";
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const navigation = [
  ...config.navigation,
  { id: "account", label: "用户中心", icon: "person" },
];
export function nav(current) {
  return `<nav aria-label="主导航">${navigation.map((item) => `<a href="#${item.id}" ${current === item.id ? 'aria-current="page"' : ""}>${icon(item.id === "personas" ? "book" : item.icon)}<span>${item.label}</span></a>`).join("")}</nav>`;
}
export const accountLink = (account) =>
  `<a class="uw-button" href="#${account ? "account" : "auth"}">${account ? "用户中心" : "登录 / 注册"}</a>`;
export function art(card, failed = false) {
  return `<div class="uw-cover" aria-hidden="true">${failed ? `<span class="uw-art-fallback">${icon("book")}封面暂未显示</span>` : `<span class="uw-cover-lines"></span><span class="uw-cover-symbol">${escape(card.symbol)}</span><span class="uw-cover-caption">${escape(card.subtitle)}</span>`}</div>`;
}
export const tags = (card) =>
  card.tags?.length
    ? `<ul class="uw-tags" aria-label="角色标签">${card.tags.map((t) => `<li>${escape(t)}</li>`).join("")}</ul>`
    : "";
export const author = (card) =>
  card.author ? `<p class="uw-meta">创作者 · ${escape(card.author)}</p>` : "";
export const action = (label, type, extra = "") =>
  `<button class="uw-button" data-browse="${type}" ${extra}>${label}</button>`;
export function filters(model) {
  return `<form id="browse-search" role="search" class="uw-search">
    <label for="browse-query">搜索角色</label><div class="uw-search-row"><input id="browse-query" type="search" autocomplete="off" enterkeyhint="search" value="${escape(model.draft)}" placeholder="名称、故事或标签"><button class="uw-button uw-primary" type="submit">${icon("search")}搜索</button></div>
    <fieldset><legend>角色分类</legend><div class="uw-categories">${config.categories.map((c) => `<label><input type="radio" name="category" value="${c}" ${model.category === c ? "checked" : ""}><span>${c}</span></label>`).join("")}</div></fieldset>
    <div class="uw-filter-actions">${action("重置筛选", "reset", 'id="browse-reset"')}<a class="uw-link" href="#role-results" data-browse="skip">跳到角色列表 ${icon("arrow")}</a></div>
  </form>`;
}
export function cardView(card, disabledReason = "", failedImage = false) {
  return `<li><article class="uw-card" data-role-card="${card.id}">
    <a class="uw-cover-link" href="#detail/${card.id}" aria-label="查看${escape(card.name)}的详情">${art(card, failedImage)}</a>
    <div class="uw-card-body"><p class="uw-meta">${escape(card.category)} · ${escape(card.subtitle)}</p><h3><a id="role-${card.id}" href="#detail/${card.id}"><span class="uw-card-title">${escape(card.name)}</span></a></h3><p class="uw-summary">${escape(card.description)}</p>${tags(card)}${author(card)}
    <div class="uw-card-actions"><a class="uw-link" href="#detail/${card.id}">查看详情<span class="uw-visually-hidden">：${escape(card.name)}</span></a>${disabledReason ? `<span class="uw-unavailable"><span class="uw-button" aria-disabled="true">开始演绎</span><small>${disabledReason}</small></span>` : `<a class="uw-button uw-primary" href="#start/${card.id}" aria-label="开始与${escape(card.name)}的演绎">开始演绎 ${icon("arrow")}</a>`}</div></div></article></li>`;
}
export function emptyState(title, text, type = "reload", label = "重新读取") {
  return `<div class="uw-empty">${icon(type === "reset" ? "search" : "book")}<h3>${title}</h3><p>${text}</p>${action(label, type)}</div>`;
}
export function detailContent(
  card,
  { scenario, offline, loading, error } = {},
) {
  const reason = offline
    ? "连接恢复并加载角色资料后，即可开始演绎。"
    : loading
      ? "正在加载角色资料，请稍候。"
      : error
        ? "角色资料读取失败，请重新读取。"
        : scenario === "blocked"
          ? "这个角色暂时无法开始演绎，可稍后重新读取。"
          : "";
  const description =
    scenario === "longtext"
      ? Array.from({ length: 12 }, () => card.description).join("\n\n")
      : card.description;
  return `<div class="uw-detail-art">${art(card, scenario === "image-failure")}${author(card)}</div><div class="uw-detail-copy"><p class="uw-meta">${escape(card.category)}</p><h1 id="detail-heading" tabindex="-1">${escape(card.name)}</h1><p class="uw-subtitle">${escape(card.subtitle)}</p>${tags(card)}<section class="uw-story"><h2>故事介绍</h2>${description
    .split("\n\n")
    .map((p) => `<p>${escape(p)}</p>`)
    .join(
      "",
    )}</section><div class="uw-start" id="start-area"><p id="start-reason" role="status">${reason || "选择演绎人格和开场，开始这段故事。"}</p><div class="uw-start-actions">${reason ? `<a id="detail-start" class="uw-button uw-primary" aria-disabled="true" aria-describedby="start-reason" tabindex="0">开始演绎 ${icon("arrow")}</a>` : `<a id="detail-start" class="uw-button uw-primary" href="#start/${card.id}">开始演绎 ${icon("arrow")}</a>`}${reason && !loading ? action("重新读取", "reload") : ""}</div></div></div>`;
}
