const scopes = {
  "persona-editor": {
    label: "第 3 批：人格创建与编辑",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速读取与保存"],
      ["failure", "人格读取失败"],
      ["write-failure", "保存失败"],
      ["unknown", "保存结果待确认"],
      ["check-failure", "结果读取失败"],
      ["offline", "离线"],
    ],
  },
  personas: {
    label: "第 3 批：演绎人格",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速读取与保存"],
      ["failure", "人格读取失败"],
      ["append-failure", "追加读取失败"],
      ["default-failure", "默认人格读取失败"],
      ["write-failure", "设置默认或删除失败"],
      ["unknown", "设置默认或删除结果待确认"],
      ["check-failure", "设置默认或删除结果读取失败"],
      ["offline", "离线"],
    ],
  },
  register: {
    label: "第 2 批：注册",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速提交"],
      ["network", "连接失败"],
      ["unknown", "注册结果待确认"],
      ["check-failure", "注册结果读取失败"],
      ["offline", "离线"],
    ],
  },
  account: {
    label: "第 2 批：用户中心",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速保存"],
      ["network", "保存失败"],
      ["unknown", "保存结果待确认"],
      ["check-failure", "保存结果读取失败"],
      ["profile-loading", "资料读取中"],
      ["profile-failure", "资料读取失败"],
      ["counts-loading", "计数读取中"],
      ["counts-failure", "计数读取失败"],
      ["offline", "离线"],
      ["expired", "登录失效"],
      ["logout-unknown", "退出结果待确认"],
    ],
  },
  browse: {
    label: "已验收：角色广场与角色详情",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速读取"],
      ["failure", "读取失败"],
      ["append-failure", "加载更多角色失败"],
      ["empty", "角色集合为空"],
      ["offline", "离线"],
      ["blocked", "暂不可开始"],
      ["image-failure", "封面不可用"],
      ["longtext", "长篇介绍"],
      ["missing", "角色无法访问"],
    ],
  },
  login: {
    label: "第 2 批：登录",
    scenarios: [
      ["normal", "正常"],
      ["slow", "慢速提交"],
      ["credentials", "邮箱或密码不正确"],
      ["network", "连接失败"],
      ["unknown", "登录结果待确认"],
      ["check-failure", "登录状态读取失败"],
      ["offline", "离线"],
    ],
  },
};
export function registerReviewScope(key, scope) {
  scopes[key] = scope;
}
let activeScope = "";
export function reviewScope(key) {
  const boundaries = document.querySelector("#review-boundaries");
  if (boundaries) boundaries.hidden = key !== "session";
  const select = document.querySelector("#review-scenario");
  const scope = scopes[key];
  document.querySelector("#review-scope").textContent =
    scope?.label || "页面访问结果";
  select.disabled = !scope;
  if (key !== activeScope) {
    select.innerHTML = (scope?.scenarios || [])
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    activeScope = key;
  }
  return select.value || "normal";
}
