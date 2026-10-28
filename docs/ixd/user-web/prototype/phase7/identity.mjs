import { loginForm, registerForm } from "./account-fields.mjs";
import { mobileAuthPage } from "./mobile.mjs";
import { desktopAuthPage } from "./desktop.mjs";
import { reviewScope } from "./review.mjs";

export function createIdentity({
  root,
  platform,
  profile,
  findAccount,
  login,
  register,
  refresh,
  navigate,
  beforeMount,
  account,
}) {
  const key = "tavern-phase7-identity-flow";
  let flow = { email: "", nickname: "", source: "discover", target: null };
  try {
    flow = { ...flow, ...JSON.parse(sessionStorage.getItem(key) || "{}") };
  } catch {}
  let current = "",
    scenario = "normal",
    pending = false,
    sequence = 0,
    notice = "";
  const isAuth = () => ["auth", "register"].includes(current);
  const feedback = (message) => {
    const el = root.querySelector("#identity-feedback");
    if (el) el.textContent = message;
  };
  const persist = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify(flow));
    } catch {
      feedback("浏览器未能保存表单，刷新后请重新填写。");
    }
  };
  const protectedRoute = (route) =>
    /^(account|personas|history|start|chat)(\/|$)/.test(route);
  const publicRoute = (route) =>
    route === "discover" || route.startsWith("detail/");
  const offline = () => scenario === "offline" || !navigator.onLine;
  function requestLogin(target) {
    flow.target = target;
    persist();
    navigate("auth");
  }
  function lock(value) {
    pending = value;
    root
      .querySelectorAll(
        '#identity-form input,#identity-form button,[data-identity="demo"]',
      )
      .forEach((el) => (el.disabled = value));
    root
      .querySelector("#identity-form")
      ?.setAttribute("aria-busy", String(value));
  }
  function clearErrors() {
    root
      .querySelectorAll("[aria-invalid]")
      .forEach((el) => el.removeAttribute("aria-invalid"));
    root
      .querySelectorAll(".uw-field-error")
      .forEach((el) => (el.textContent = ""));
  }
  function invalid(name, message) {
    const input = root.querySelector(`[name="${name}"]`);
    input.setAttribute("aria-invalid", "true");
    root.querySelector(`#identity-${name}-error`).textContent = message;
    input.focus();
    input.scrollIntoView({ block: "nearest" });
  }
  function validate() {
    clearErrors();
    const value = (name) => root.querySelector(`[name="${name}"]`);
    if (current === "register" && !value("nickname").value.trim()) {
      invalid("nickname", "请填写昵称。");
      return false;
    }
    if (!value("email").value.trim()) {
      invalid("email", "请填写邮箱。");
      return false;
    }
    if (value("email").validity.typeMismatch) {
      invalid("email", "请填写完整的邮箱地址。");
      return false;
    }
    if (!value("password").value) {
      invalid("password", "请填写密码。");
      return false;
    }
    if (
      current === "register" &&
      value("password").value !== value("confirmation").value
    ) {
      invalid("confirmation", "两次输入的密码不一致，请重新输入确认密码。");
      return false;
    }
    return true;
  }
  function recovery(kind, message) {
    feedback(message);
    root.querySelector("#identity-recovery").innerHTML =
      `<button class="uw-button" type="button" data-identity="verify-${kind}">${kind === "login" ? "重新核对登录状态" : "核对注册结果"}</button>`;
    if (kind === "register")
      root.querySelector("#identity-submit").disabled = true;
  }
  function completeLogin(email) {
    if (!email || !findAccount(email)) {
      feedback("登录状态读取失败，请重新登录。");
      return;
    }
    const target = flow.target || "account";
    flow.target = null;
    flow.loginEmail = null;
    flow.registration = null;
    persist();
    login(email, target);
  }
  function completeRegistration() {
    flow.email = flow.registration.email;
    flow.registration = null;
    persist();
    notice = "账号已创建，请登录";
    navigate("auth");
  }
  async function submit(demo = false) {
    if (pending) return;
    if (current === "register" && flow.registration) {
      recovery("register", "注册结果尚未确认，请先核对注册结果。");
      return;
    }
    if (!demo && !validate()) return;
    const registering = current === "register";
    if (offline()) {
      feedback(`当前离线，请连接网络后再${registering ? "注册" : "登录"}。`);
      return;
    }
    const email = demo
      ? "traveler@example.com"
      : root.querySelector('[name="email"]').value.trim().toLowerCase();
    const outcome = scenario,
      at = current;
    if (registering && findAccount(email)) {
      invalid("email", "这个邮箱已有模拟账号，请前往登录。");
      return;
    }
    flow.email = email;
    persist();
    lock(true);
    feedback(registering ? "正在创建账号…" : "正在登录…");
    if (registering && outcome !== "network") {
      register({ name: flow.nickname.trim(), email });
      flow.registration = { email };
      persist();
    }
    const ticket = ++sequence;
    await new Promise((r) => setTimeout(r, outcome === "slow" ? 1500 : 180));
    if (ticket !== sequence || current !== at) return;
    lock(false);
    if (outcome === "network") {
      feedback("连接失败，请重试");
      return;
    }
    if (registering) {
      if (["unknown", "check-failure"].includes(outcome))
        recovery("register", "注册结果尚未确认，请先核对注册结果。");
      else completeRegistration();
      return;
    }
    if (outcome === "credentials" || !findAccount(email)) {
      feedback("邮箱或密码不正确");
      return;
    }
    if (["unknown", "check-failure"].includes(outcome)) {
      flow.loginEmail = email;
      persist();
      recovery("login", "登录结果尚未确认，请重新读取登录状态。");
      return;
    }
    completeLogin(email);
  }
  function render(route) {
    const previous = current;
    current = route;
    if (previous !== route) {
      sequence++;
      pending = false;
    }
    if (publicRoute(route)) flow.source = route;
    if (protectedRoute(route) && !profile().account) {
      requestLogin(route);
      return true;
    }
    if (!isAuth()) return account?.render(route) || false;
    account?.render(route);
    if (profile().account) {
      const target = flow.target || "account";
      flow.target = null;
      persist();
      navigate(target);
      return true;
    }
    if (previous && publicRoute(previous) && !flow.target)
      flow.target = previous;
    persist();
    beforeMount();
    scenario = reviewScope(current === "auth" ? "login" : "register");
    const content = current === "auth" ? loginForm(flow) : registerForm(flow);
    root.innerHTML = (platform === "mobile" ? mobileAuthPage : desktopAuthPage)(
      {
        content,
        pageId: current === "auth" ? "P05" : "P06",
        back: current === "register" ? "auth" : flow.source,
        backLabel:
          current === "register"
            ? "返回登录"
            : flow.source.startsWith("detail/")
              ? "返回角色详情"
              : "返回角色广场",
      },
    );
    if (current === "auth" && previous === "register")
      root.querySelector('[name="password"]').focus();
    feedback(notice || (offline() ? "当前离线，请连接网络后再提交。" : ""));
    notice = "";
    if (current === "register" && flow.registration)
      recovery("register", "注册结果尚未确认，请先核对注册结果。");
    if (current === "auth" && flow.loginEmail)
      recovery("login", "登录结果尚未确认，请重新读取登录状态。");
    return true;
  }
  root.addEventListener("input", (e) => {
    if (!isAuth()) return;
    if (["email", "nickname"].includes(e.target.name)) {
      flow[e.target.name] = e.target.value;
      persist();
    }
    if (e.target.matches("input")) {
      e.target.removeAttribute("aria-invalid");
      root.querySelector(`#identity-${e.target.name}-error`).textContent = "";
    }
  });
  root.addEventListener("keydown", (e) => {
    if (isAuth() && e.key === "Enter" && e.isComposing) e.preventDefault();
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id === "identity-form") {
      e.preventDefault();
      void submit();
    }
  });
  root.addEventListener("click", (e) => {
    const button = e.target.closest("[data-identity]");
    if (!button || !isAuth()) return;
    if (button.dataset.identity === "reveal") {
      const input = root.querySelector(`[name="${button.dataset.field}"]`),
        start = input.selectionStart,
        end = input.selectionEnd;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      input.setSelectionRange(start, end);
      button.textContent = visible ? "隐藏" : "显示";
      button.setAttribute(
        "aria-label",
        `${visible ? "隐藏" : "显示"}${input.name === "confirmation" ? "确认密码" : "密码"}`,
      );
      button.setAttribute("aria-pressed", String(visible));
    }
    if (button.dataset.identity === "demo") void submit(true);
    if (button.dataset.identity === "verify-login") {
      if (scenario === "check-failure" || offline())
        feedback("登录状态读取失败，请检查连接后重试。");
      else completeLogin(flow.loginEmail);
    }
    if (button.dataset.identity === "verify-register") {
      if (scenario === "check-failure" || offline())
        feedback("注册结果读取失败，请检查连接后重试。");
      else if (findAccount(flow.registration?.email || ""))
        completeRegistration();
      else {
        flow.registration = null;
        persist();
        root.querySelector("#identity-recovery").innerHTML = "";
        root.querySelector("#identity-submit").disabled = false;
        feedback("尚未创建账号，请重新提交。");
      }
    }
  });
  document.querySelector("#review-scenario").addEventListener("change", (e) => {
    if (!isAuth()) return;
    scenario = e.target.value;
    feedback(offline() ? "当前离线，请连接网络后再提交。" : "");
  });
  addEventListener("offline", () => {
    if (isAuth()) feedback("当前离线，请连接网络后再提交。");
  });
  addEventListener("online", () => {
    if (isAuth()) feedback("网络已恢复，可以继续提交。");
  });
  function refreshVisible(event) {
    if (
      !isAuth() ||
      (event.type === "visibilitychange" &&
        document.visibilityState === "hidden")
    )
      return;
    refresh();
    if (profile().account) {
      const target = flow.target || "account";
      flow.target = null;
      persist();
      navigate(target);
    }
  }
  addEventListener("storage", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  return { render, requestLogin };
}
