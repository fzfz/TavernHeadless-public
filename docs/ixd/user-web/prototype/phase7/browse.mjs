import { config } from "../data.mjs";
import { reviewScope } from "./review.mjs";
import { cardView, emptyState, detailContent, action } from "./components.mjs";
import { mobilePage } from "./mobile.mjs";
import { desktopPage } from "./desktop.mjs";

export function createBrowse({ root, platform, account, navigate, start }) {
  const storageKey = `tavern-phase7-browse-${platform}`;
  const defaults = {
    draft: "",
    query: "",
    category: "全部",
    limit: 3,
    anchor: null,
    scroll: 0,
    cached: null,
    detailIds: [],
    detailScroll: {},
  };
  let model = { ...defaults };
  let storageFailed = false;
  try {
    model = {
      ...defaults,
      ...JSON.parse(sessionStorage.getItem(storageKey) || "{}"),
    };
  } catch {
    storageFailed = true;
  }
  let current = "",
    generation = 0,
    scenario = "normal",
    pending = false,
    append = false,
    error = false,
    records = [],
    total = 0,
    readCondition = "",
    restore = false;
  const pageRenderer = platform === "mobile" ? mobilePage : desktopPage;
  const offline = () => scenario === "offline" || !navigator.onLine;
  const condition = () =>
    [model.category, model.query ? `“${model.query}”` : ""]
      .filter(Boolean)
      .join(" · ");
  const persist = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(model));
    } catch {
      storageFailed = true;
    }
  };
  const card = (id) => config.cards.find((c) => c.id === id);
  const remember = () => {
    const scroll = root.querySelector("#browse-scroll");
    if (!scroll) return;
    if (current === "discover") model.scroll = scroll.scrollTop;
    if (current.startsWith("detail/"))
      model.detailScroll[current.split("/")[1]] = scroll.scrollTop;
    persist();
  };
  let restoreDetail = false;
  function placeMobileActions() {
    if (platform !== "mobile") return;
    const actions = root.querySelector("#start-area");
    const footer = root.querySelector("#mobile-detail-actions");
    const copy = root.querySelector(".uw-detail-copy");
    if (!actions || !footer || !copy) return;
    const pinned =
      root.clientHeight >= 500 &&
      parseFloat(getComputedStyle(copy).fontSize) < 24;
    const parent = pinned ? footer : copy;
    if (actions.parentElement !== parent) parent.append(actions);
  }
  new ResizeObserver(placeMobileActions).observe(root);
  const scrollIntoView = (target) =>
    target?.scrollIntoView({ block: "nearest" });
  function status(route = current) {
    reviewScope(
      ["discover", "detail"].includes(route.split("/")[0]) ? "browse" : null,
    );
  }
  function presentResults() {
    const target = root.querySelector("#browse-results");
    if (!target) return;
    target.setAttribute("aria-busy", String(pending));
    const count =
      total > records.length
        ? `共 ${total} 个角色 · 已加载 ${records.length} 个`
        : `共 ${total} 个角色`;
    const feedback = offline()
      ? records.length
        ? "当前离线，正在显示已读取的角色。连接恢复后将重新读取。"
        : "当前离线，请连接网络后加载角色。"
      : pending
        ? `${append ? "正在加载更多角色" : "正在读取：" + condition()}…`
        : error
          ? `${append ? "更多角色加载失败，已读取的角色仍可浏览。" : "角色读取失败，请重试。"}`
          : "";
    const summary = records.length
      ? count
      : pending
        ? "正在读取角色"
        : error
          ? "角色尚未读取"
          : count;
    const html = `<div class="uw-result-heading"><h2 id="role-results" tabindex="-1">${summary}</h2><p class="uw-meta">${records.length ? readCondition : condition()}</p></div><p class="uw-feedback" role="status" aria-live="polite">${feedback}</p>${storageFailed ? '<p role="alert">浏览器未能保存筛选条件，请保持当前页面打开。</p>' : ""}${records.length ? `<ul class="uw-card-list">${records.map((c) => cardView(c, offline() ? "联网并加载角色资料后可开始演绎" : scenario === "blocked" ? "暂时无法与这个角色开始演绎。" : "", scenario === "image-failure")).join("")}</ul>` : pending ? '<div class="uw-skeleton" aria-hidden="true"><div></div><div></div><div></div></div>' : error ? emptyState("角色读取失败", "请检查连接后重试。", "reload", "重试读取") : offline() ? emptyState("还没有可离线阅读的角色", "连接恢复后可重新读取。") : model.query || model.category !== "全部" ? emptyState("没有符合条件的角色", "试试其他名称、故事或标签。", "reset", "重置筛选") : emptyState("暂无可浏览的角色", "可以稍后重新读取。")}<div class="uw-pagination">${records.length && (records.length < total || error) ? action(pending ? "正在加载…" : error ? "重试读取" : "加载更多", error ? "retry-append" : "more", `id="browse-more" ${pending ? 'aria-disabled="true"' : ""}`) : ""}${records.length && offline() ? action("重新读取", "reload") : ""}</div>`;
    const focused = document.activeElement?.id;
    target.innerHTML = html;
    root.querySelector("#browse-reset").hidden =
      !model.query && model.category === "全部" && !model.draft;
    if (focused && target.querySelector(`#${CSS.escape(focused)}`))
      target
        .querySelector(`#${CSS.escape(focused)}`)
        .focus({ preventScroll: true });
    else if (focused === "browse-more")
      root.querySelector("#role-results")?.focus({ preventScroll: true });
    if (restore && !pending) {
      restore = false;
      const scroll = root.querySelector("#browse-scroll");
      scroll.scrollTop = model.scroll;
      if (model.anchor) {
        const el = root.querySelector(`#role-${model.anchor}`);
        (el || root.querySelector("#role-results")).focus({
          preventScroll: true,
        });
        scrollIntoView(el);
      }
    }
  }
  function presentDetail(id, { loading = false, error = false } = {}) {
    const target = root.querySelector("#browse-detail");
    if (!target) return;
    const entry = card(id);
    root.querySelector("#mobile-detail-actions")?.replaceChildren();
    if (!entry || scenario === "missing") {
      navigate(`unavailable/${id}`);
      return;
    }
    const cached = model.detailIds.includes(id);
    const activeId = document.activeElement?.id;
    if ((loading || error || offline()) && !cached) {
      target.innerHTML = `<div class="uw-detail-pending"><h1 id="detail-heading" tabindex="-1">${error ? "角色资料读取失败" : offline() ? "还没有可离线阅读的资料" : "正在读取角色资料"}</h1><p role="status">${loading ? "读取完成后即可查看故事介绍。" : "请检查连接后重新读取。"}</p>${loading ? "" : action("重新读取", "reload")}<span class="uw-button" aria-disabled="true">开始演绎</span></div>`;
    } else
      target.innerHTML = detailContent(entry, {
        scenario,
        offline: offline(),
        loading,
        error,
      });
    placeMobileActions();
    if (restoreDetail && !loading) {
      root.querySelector("#browse-scroll").scrollTop =
        model.detailScroll[id] || 0;
      restoreDetail = false;
    }
    if (activeId)
      root
        .querySelector(`#${CSS.escape(activeId)}`)
        ?.focus({ preventScroll: true });
  }
  async function read({ more = false, retry = false } = {}) {
    const ticket = ++generation,
      route = current;
    pending = true;
    append = more;
    error = false;
    if (current === "discover") presentResults();
    else presentDetail(current.split("/")[1], { loading: true });
    if (offline()) {
      pending = false;
      if (current === "discover") presentResults();
      else presentDetail(current.split("/")[1]);
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, scenario === "slow" ? 1500 : 140),
    );
    if (ticket !== generation || route !== current) return;
    pending = false;
    error =
      (scenario === "failure" || (scenario === "append-failure" && more)) &&
      !retry;
    if (current === "discover") {
      if (!error) {
        const needle = model.query.toLocaleLowerCase();
        const matches =
          scenario === "empty"
            ? []
            : config.cards.filter(
                (c) =>
                  (model.category === "全部" ||
                    c.category === model.category) &&
                  `${c.name} ${c.subtitle} ${c.description} ${c.tags.join(" ")}`
                    .toLocaleLowerCase()
                    .includes(needle),
              );
        if (more) model.limit += 3;
        total = matches.length;
        records = matches.slice(0, model.limit);
        readCondition = condition();
        model.cached = {
          ids: records.map((c) => c.id),
          total,
          condition: readCondition,
        };
        persist();
      }
      presentResults();
    } else {
      const id = current.split("/")[1];
      if (!error && card(id) && !model.detailIds.includes(id)) {
        model.detailIds.push(id);
        persist();
      }
      presentDetail(id, { error });
      if (document.activeElement === document.body)
        root.querySelector("#detail-heading")?.focus({ preventScroll: true });
    }
  }
  function render(route) {
    if (current !== route) remember();
    const changed = current !== route;
    current = route;
    status();
    const kind = route.split("/")[0];
    if (kind === "start") {
      generation++;
      const id = route.split("/")[1];
      if (card(id)) {
        start(id);
        status(route);
      } else navigate(`detail/${id}`);
      return true;
    }
    if (kind === "unavailable") {
      generation++;
      root.innerHTML = `<main class="uw-result" data-page-id="P22"><h1 tabindex="-1">页面无法访问</h1><p>这个角色暂时无法访问，请返回角色广场选择其他角色。</p><a class="uw-button" href="#discover">返回角色广场</a></main>`;
      root.querySelector("h1").focus();
      return true;
    }
    if (!["discover", "detail"].includes(kind)) {
      generation++;
      return false;
    }
    if (!changed && root.querySelector("[data-page-id]")) return true;
    generation++;
    pending = false;
    error = false;
    append = false;
    root.innerHTML = pageRenderer({ kind, model, account: account() });
    const scroll = root.querySelector("#browse-scroll");
    if (kind === "discover") {
      records = model.cached?.ids.map(card).filter(Boolean) || [];
      total = model.cached?.total || 0;
      readCondition = model.cached?.condition || condition();
      restore = true;
    }
    restoreDetail = kind === "detail";
    scroll.addEventListener("scroll", remember, { passive: true });
    void read();
    return true;
  }
  function changeFilters() {
    model.limit = 3;
    model.anchor = null;
    model.scroll = 0;
    persist();
    void read();
  }
  root.addEventListener("input", (e) => {
    if (e.target.id === "browse-query") {
      model.draft = e.target.value;
      persist();
      root.querySelector("#browse-reset").hidden =
        !model.query && model.category === "全部" && !model.draft;
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.name === "category") {
      model.category = e.target.value;
      changeFilters();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "browse-query" && e.key === "Enter" && e.isComposing)
      e.preventDefault();
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "browse-search") return;
    e.preventDefault();
    model.query = model.draft.trim();
    changeFilters();
    if (platform === "mobile")
      root
        .querySelector('#browse-search [type="submit"]')
        .focus({ preventScroll: true });
  });
  root.addEventListener("click", (e) => {
    const target = e.target.closest("a,button");
    if (!target) return;
    if (target.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      return;
    }
    const action = target.dataset.browse;
    if (action === "skip") {
      e.preventDefault();
      const heading = root.querySelector("#role-results");
      heading.focus();
      scrollIntoView(heading);
      return;
    }
    if (action === "reset") {
      model.draft = "";
      model.query = "";
      model.category = "全部";
      root.querySelector("#browse-query").value = "";
      root.querySelector('[name="category"][value="全部"]').checked = true;
      root.querySelector("#browse-query").focus({ preventScroll: true });
      changeFilters();
      return;
    }
    if (action === "more" || action === "retry-append") {
      if (!pending) void read({ more: true, retry: action === "retry-append" });
      return;
    }
    if (action === "reload") {
      void read({ retry: true });
      return;
    }
    if (action === "back" && target.tagName === "BUTTON") {
      navigate("discover");
      return;
    }
    const destination = target.getAttribute("href")?.slice(1);
    if (destination === current) {
      e.preventDefault();
      return;
    }
    if (current === "discover" && /^(detail|start)\//.test(destination || "")) {
      model.anchor = destination.split("/")[1];
      remember();
    }
  });
  document.querySelector("#review-scenario").addEventListener("change", (e) => {
    if (!["discover", "detail"].includes(current.split("/")[0])) return;
    scenario = e.target.value;
    model.limit = 3;
    if (scenario === "failure" || scenario === "empty") {
      records = [];
      model.cached = null;
    }
    void read();
  });
  document.querySelector("#review-theme").addEventListener("click", (e) => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    e.target.setAttribute("aria-pressed", String(dark));
  });
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      ["discover", "detail"].includes(current.split("/")[0])
    )
      void read();
  });
  addEventListener("online", () => {
    if (["discover", "detail"].includes(current.split("/")[0])) void read();
  });
  addEventListener("offline", () => {
    if (["discover", "detail"].includes(current.split("/")[0])) void read();
  });
  return {
    render,
    suspend() {
      remember();
      current = "";
      generation++;
    },
  };
}
