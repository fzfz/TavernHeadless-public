import { escape } from "./components.mjs";
export function field(
  { name, label, type = "text", autocomplete, hint },
  value = "",
) {
  const password = type === "password";
  return `<div class="uw-field"><label for="identity-${name}">${label}</label><div class="uw-field-input"><input id="identity-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" value="${escape(value)}" required aria-describedby="${hint ? `identity-${name}-hint ` : ""}identity-${name}-error">${password ? `<button class="uw-button uw-reveal" type="button" data-identity="reveal" data-field="${name}" aria-label="显示${label}" aria-pressed="false">显示</button>` : ""}</div>${hint ? `<p class="uw-meta" id="identity-${name}-hint">${hint}</p>` : ""}<p class="uw-field-error" id="identity-${name}-error"></p></div>`;
}
export function loginForm(values) {
  return `<div class="uw-auth-heading"><span class="uw-meta">模拟账号流程</span><h1 id="identity-heading" tabindex="-1">登录</h1><p class="uw-meta">请使用虚构邮箱和测试密码。密码仅用于表单演示。</p></div><form id="identity-form" novalidate class="uw-identity-form">${field({ name: "email", label: "邮箱", type: "email", autocomplete: "username" }, values.email)}${field({ name: "password", label: "密码", type: "password", autocomplete: "current-password" })}<div id="identity-feedback" class="uw-form-feedback" role="status" aria-live="polite"></div><div id="identity-recovery"></div><button class="uw-button uw-primary" id="identity-submit" type="submit">登录并继续</button></form><div class="uw-auth-links"><a class="uw-link" href="#register">注册账号</a><button class="uw-button" type="button" data-identity="demo">使用演示账号体验</button></div>`;
}

export function registerForm(values) {
  return `<div class="uw-auth-heading"><span class="uw-meta">模拟账号流程</span><h1 id="identity-heading" tabindex="-1">注册账号</h1><p class="uw-meta">请使用虚构邮箱和测试密码。密码仅用于表单演示。</p></div><form id="identity-form" novalidate class="uw-identity-form">${field({ name: "nickname", label: "昵称", autocomplete: "nickname", hint: "用于显示你的账号名称。" }, values.nickname)}${field({ name: "email", label: "邮箱", type: "email", autocomplete: "username" }, values.email)}${field({ name: "password", label: "密码", type: "password", autocomplete: "new-password" })}${field({ name: "confirmation", label: "确认密码", type: "password", autocomplete: "new-password" })}<div id="identity-feedback" class="uw-form-feedback" role="status" aria-live="polite"></div><div id="identity-recovery"></div><button class="uw-button uw-primary" id="identity-submit" type="submit">创建账号</button></form><div class="uw-auth-links"><a class="uw-link" href="#auth">已有账号，前往登录</a></div>`;
}
