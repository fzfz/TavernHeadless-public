import { nav, accountLink, filters, escape } from "./components.mjs";
export function mobilePage({ kind, model, account }) {
  const discover = kind === "discover";
  return `<div class="uw-mobile" data-page-id="${discover ? "P02" : "P04"}"><header class="uw-mobile-header">${discover ? "<h1>角色广场</h1>" : '<a class="uw-link" href="#discover" data-browse="back">返回角色广场</a><span>角色详情</span>'}${discover ? accountLink(account) : ""}</header><main class="uw-scroll" id="browse-scroll">${discover ? `${filters(model)}<section id="browse-results" aria-label="角色列表"></section>` : '<div id="browse-detail" class="uw-detail"></div>'}</main>${discover ? `<footer class="uw-bottom-nav">${nav("discover")}</footer>` : '<div id="mobile-detail-actions" class="uw-mobile-detail-actions"></div>'}</div>`;
}

export function mobileAuthPage({ content, pageId, back, backLabel }) {
  return `<div class="uw-mobile uw-auth" data-page-id="${pageId}"><main class="uw-scroll uw-auth-scroll"><a class="uw-link uw-auth-back" href="#${escape(back)}">${backLabel}</a><div class="uw-auth-brand">Tavern.</div><section class="uw-auth-card">${content}</section></main></div>`;
}

export function mobileAccountPage(content) {
  return `<div class="uw-mobile uw-account" data-page-id="P08"><header class="uw-mobile-header"><span>Tavern.</span><span class="uw-meta">用户中心</span></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main><footer class="uw-bottom-nav">${nav("account")}</footer></div>`;
}

export function mobilePersonaPage({
  content,
  pageId,
  title,
  back = "personas",
  backLabel = "返回人格列表",
}) {
  const list = pageId === "P10";
  return `<div class="uw-mobile uw-personas" data-page-id="${pageId}"><header class="uw-mobile-header">${list ? "<span>Tavern.</span>" : `<a class="uw-link" href="#${escape(back)}">${backLabel}</a>`}<span>${title}</span></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main>${list ? `<footer class="uw-bottom-nav">${nav("personas")}</footer>` : ""}</div>`;
}
