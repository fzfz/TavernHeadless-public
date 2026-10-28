import { nav, accountLink, filters, escape } from "./components.mjs";
import { icon } from "../icons.mjs";
export function desktopPage({ kind, model, account }) {
  const discover = kind === "discover";
  return `<div class="uw-desktop" data-page-id="${discover ? "P01" : "P03"}"><aside class="uw-sidebar"><a class="uw-brand" href="#discover">${icon("book")}<strong>Tavern.</strong></a><p class="uw-meta">角色演绎</p>${nav("discover")}</aside><div class="uw-workspace"><header class="uw-desktop-header"><p class="uw-meta">Tavern / <strong>${discover ? "角色广场" : "角色详情"}</strong></p>${accountLink(account)}</header><main id="browse-scroll" class="uw-scroll"><div class="uw-page-width">${discover ? `<header class="uw-page-heading"><h1>角色广场</h1></header>${filters(model)}<section id="browse-results" aria-label="角色列表"></section>` : '<a class="uw-link uw-back" href="#discover" data-browse="back">' + icon("left") + '返回角色广场</a><div id="browse-detail" class="uw-detail"></div>'}</div></main></div></div>`;
}

export function desktopAuthPage({ content, pageId, back, backLabel }) {
  return `<div class="uw-desktop-auth uw-desktop uw-auth" data-page-id="${pageId}"><main class="uw-scroll uw-auth-scroll"><a class="uw-link uw-auth-back" href="#${escape(back)}">${backLabel}</a><div class="uw-auth-brand">Tavern.</div><section class="uw-auth-card">${content}</section></main></div>`;
}

export function desktopAccountPage(content) {
  return `<div class="uw-desktop uw-account" data-page-id="P07"><aside class="uw-sidebar"><a class="uw-brand" href="#discover">${icon("book")}<strong>Tavern.</strong></a><p class="uw-meta">角色演绎</p>${nav("account")}</aside><div class="uw-workspace"><header class="uw-desktop-header"><p class="uw-meta">Tavern / <strong>用户中心</strong></p></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main></div></div>`;
}

export function desktopPersonaPage({ content, pageId, title }) {
  return `<div class="uw-desktop uw-personas" data-page-id="${pageId}"><aside class="uw-sidebar"><a class="uw-brand" href="#discover">${icon("book")}<strong>Tavern.</strong></a><p class="uw-meta">角色演绎</p>${nav("personas")}</aside><div class="uw-workspace"><header class="uw-desktop-header"><p class="uw-meta">Tavern / <strong>${title}</strong></p></header><main class="uw-scroll"><div class="uw-page-width">${content}</div></main></div></div>`;
}
