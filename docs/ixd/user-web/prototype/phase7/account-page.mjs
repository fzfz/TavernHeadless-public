import { escape } from "./components.mjs";
export const accountButton = (label, action, extra = "") =>
  `<button type="button" class="uw-button" data-account="${action}" ${extra}>${label}</button>`;
export function accountContent({ user, editing, draft, scenario }) {
  const failed = scenario === "profile-failure",
    loading = scenario === "profile-loading";
  const count = (value, unit) =>
    scenario === "counts-loading"
      ? "正在读取…"
      : scenario === "counts-failure" && unit === "个人格"
        ? "数量暂不可用"
        : `${value} ${unit}`;
  return `<header class="uw-page-heading"><div><p class="uw-meta">模拟账号 · 资料保存在当前浏览器</p><h1>用户中心</h1></div></header><div class="uw-account-profile"><section aria-labelledby="account-name" class="uw-account-panel">${loading ? `<h2 id="account-name">正在读取账号资料…</h2>` : failed ? `<h2 id="account-name">账号资料读取失败</h2><p>请重新读取账号资料。</p>${accountButton("重新读取资料", "reload-profile")}` : `<p class="uw-account-avatar" aria-hidden="true">${escape(user.account.name.slice(0, 1))}</p><h2 id="account-name">${escape(user.account.name)}</h2><p class="uw-meta">${escape(user.account.email)}</p>${editing ? `<form id="nickname-form" novalidate class="uw-identity-form"><div class="uw-field"><label for="account-nickname">昵称</label><div class="uw-field-input"><input id="account-nickname" name="nickname" autocomplete="nickname" value="${escape(draft)}" required aria-describedby="account-nickname-hint account-nickname-error"></div><p id="account-nickname-hint" class="uw-meta">昵称用于显示账号名称。演绎中的人物身份由演绎人格决定。</p><p id="account-nickname-error" class="uw-field-error"></p></div><div class="uw-form-actions"><button class="uw-button uw-primary" type="submit">保存昵称</button>${accountButton("取消", "cancel")}</div></form>` : accountButton("编辑昵称", "edit", 'id="account-edit"')}`}</section><section aria-labelledby="account-resources" class="uw-account-panel"><h2 id="account-resources">我的内容</h2><div class="uw-resource-grid"><a class="uw-resource" href="#personas"><strong>演绎人格</strong><span>${count(user.personas.length, "个人格")}</span></a><a class="uw-resource" href="#history"><strong>历史演绎</strong><span>${count(user.sessions.length, "段演绎")}</span></a></div>${scenario === "counts-failure" ? accountButton("重新读取数量", "reload-counts") : ""}</section></div><div id="account-feedback" class="uw-form-feedback" role="status" aria-live="polite"></div><div id="account-recovery"></div><div class="uw-account-exit">${accountButton("退出登录", "logout")}</div>`;
}
