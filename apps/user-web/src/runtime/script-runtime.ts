import { createVisibilityAnimations } from "./visibility-animation.js";
import {
  apiErrorMessages,
  roleRuntimeValidators,
  roleRuntimeHistoryPagination,
  nativeCardFileRules,
} from "@tavern/shared";
import type { RoleRuntimeOptions, RoleDisplaySnapshot } from "@tavern/shared";
const TERMINAL_STREAM_TYPES = new Set(["end", "error", "cancelled"]);

export function resolveRoleDocumentUrls(html: string, documentUrl: string, assetOriginOffsets: readonly number[]): string {
  const url = new URL(documentUrl, globalThis.location?.href);
  const assetRoute = url.pathname.indexOf("/role-assets/");
  const origin = url.origin + (assetRoute < 0 ? "" : url.pathname.slice(0, assetRoute));
  let result = "";
  let previous = 0;
  for (const offset of assetOriginOffsets) {
    result += html.slice(previous, offset) + origin;
    previous = offset;
  }
  return result + html.slice(previous);
}

function byteLength(value: any) {
  const text = JSON.stringify(value);
  return new TextEncoder().encode(text).length;
}

export class BoundedCache {
  #entries = new Map();
  #bytes = 0;
  #maxEntries;
  #maxBytes;

  constructor({ maxEntries, maxBytes }: any) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new TypeError(apiErrorMessages.ROLE_RUNTIME_CACHE_ENTRIES_INVALID);
    if (!Number.isInteger(maxBytes) || maxBytes < 1)
      throw new TypeError(apiErrorMessages.ROLE_RUNTIME_CACHE_BYTES_INVALID);
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
  }

  get size() {
    return this.#entries.size;
  }

  get bytes() {
    return this.#bytes;
  }

  has(key: any) {
    return this.#entries.has(key);
  }

  get(key: any) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: any, value: any) {
    this.delete(key);
    const bytes = byteLength({ key, value });
    if (bytes > this.#maxBytes) return false;
    this.#entries.set(key, { value, bytes });
    this.#bytes += bytes;
    while (
      this.#entries.size > this.#maxEntries ||
      this.#bytes > this.#maxBytes
    ) {
      const oldestKey = this.#entries.keys().next().value;
      this.delete(oldestKey);
    }
    return true;
  }

  delete(key: any) {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    return true;
  }

  clear() {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

export class ScriptRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeError";
    this.code = code;
  }
}

function cloneReadonly(value: any) {
  const clone =
    typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  const freeze = (item: any) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const child of Object.values(item)) freeze(child);
    return Object.freeze(item);
  };
  return freeze(clone);
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createDisposableScope() {
  let active = true;
  const pending = new Set<{ reject: (reason?: unknown) => void }>();
  return {
    get active() {
      return active;
    },
    wait(promise: any) {
      if (!active)
        return Promise.reject(
          new Error(apiErrorMessages.ROLE_RUNTIME_SCOPE_DISPOSED),
        );
      return new Promise<any>((resolve: any, reject: any) => {
        const token = { reject };
        pending.add(token);
        Promise.resolve(promise).then(
          (value: any) => {
            pending.delete(token);
            if (active) resolve(value);
            else
              reject(new Error(apiErrorMessages.ROLE_RUNTIME_SCOPE_DISPOSED));
          },
          (error: any) => {
            pending.delete(token);
            reject(error);
          },
        );
      });
    },
    dispose() {
      if (!active) return;
      active = false;
      for (const token of pending)
        token.reject(new Error(apiErrorMessages.ROLE_RUNTIME_SCOPE_DISPOSED));
      pending.clear();
    },
  };
}

export function mountVirtualList({
  container,
  branchId,
  listItems,
  getRecord,
  itemKey,
  render,
  onError,
  onChange,
  overscan = 2,
  pageSize = roleRuntimeHistoryPagination.defaultLimit,
  floorHtml = "",
  floorHtmlUrl,
  floorHtmlAssetOriginOffsets,
  followTail = false,
  createScope = createDisposableScope,
  cache,
}: any) {
  if (!container || typeof container.append !== "function")
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_CONTAINER_INVALID);
  if (typeof branchId !== "string" || !branchId)
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_BRANCH_INVALID);
  if (
    typeof listItems !== "function" ||
    typeof getRecord !== "function" ||
    typeof itemKey !== "function"
  )
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_READERS_INVALID);
  if (typeof render !== "function")
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_RENDER_INVALID);
  if (!Number.isInteger(overscan) || overscan < 0)
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_OVERSCAN_INVALID);
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > roleRuntimeHistoryPagination.maxLimit
  )
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_PAGE_SIZE_INVALID);
  if (typeof followTail !== "boolean")
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_LIST_FOLLOW_INVALID);

  const document = container.ownerDocument || globalThis.document;
  const items: any[] = [];
  let refreshPending = false;
  let refreshing = false;
  let retryRendering = false;
  const rows: HTMLElement[] = [];
  const measuredHeights = new Map();
  const mounted = new Map();
  let nextCursor: string | null | undefined;
  let loading: { generation: number; promise: Promise<void> | null } | null =
    null;
  let destroyed = false;
  let generation = 0;
  let visibleStart = 0;
  let visibleEnd = 0;
  let averageHeight = 96;

  const publish = () =>
    onChange?.({
      hasNextPage: nextCursor !== null,
      loading: refreshing || Boolean(loading),
    });
  const background = (operation: () => Promise<void>) => {
    void operation().catch((error) => onError(error, operation));
  };

  const itemIdentity = (item: any) => `${branchId}\u0000${itemKey(item)}`;

  const rowHeight = (index: any) => {
    const row = rows[index];
    if (!row) return averageHeight;
    const rectangle = row.getBoundingClientRect?.();
    const measured = Number(rectangle?.height || row.offsetHeight);
    if (Number.isFinite(measured) && measured > 0) return measured;
    const placeholder = Number.parseFloat(row.style.minHeight);
    return Number.isFinite(placeholder) && placeholder > 0
      ? placeholder
      : averageHeight;
  };

  const rowTop = (index: any) => {
    const row = rows[index];
    if (!row) return 0;
    if (
      typeof row.getBoundingClientRect === "function" &&
      typeof container.getBoundingClientRect === "function"
    ) {
      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return (
        rowRect.top - containerRect.top + (Number(container.scrollTop) || 0)
      );
    }
    let top = 0;
    for (let current = 0; current < index; current += 1)
      top += rowHeight(current);
    return top;
  };

  const scrollHeight = () => {
    const measured = Number(container.scrollHeight);
    if (Number.isFinite(measured) && measured > 0) return measured;
    let height = 0;
    for (let index = 0; index < rows.length; index += 1)
      height += rowHeight(index);
    return height;
  };

  const visibleRangeFromDom = () => {
    if (!rows.length) return { start: 0, end: 0 };
    const scrollTop = Number(container.scrollTop) || 0;
    if (document.visibilityState === "hidden") return { start: 0, end: -1 };
    if (
      typeof container.checkVisibility === "function" &&
      !container.checkVisibility()
    )
      return { start: 0, end: -1 };
    if (
      typeof container.getClientRects === "function" &&
      container.getClientRects().length === 0
    )
      return { start: 0, end: -1 };
    const viewportHeight = Number(container.clientHeight) || 0;
    if (viewportHeight <= 0) return { start: 0, end: -1 };
    const viewportBottom = scrollTop + viewportHeight;
    let start = rows.length - 1;
    let end = start;
    let found = false;
    for (let index = 0; index < rows.length; index += 1) {
      const top = rowTop(index);
      const bottom = top + rowHeight(index);
      if (!found && bottom > scrollTop) {
        start = index;
        end = index;
        found = true;
      }
      if (found && top < viewportBottom) end = index;
      if (found && top >= viewportBottom) break;
    }
    return { start, end };
  };

  const isAtBottom = () =>
    scrollHeight() -
      ((Number(container.scrollTop) || 0) +
        (Number(container.clientHeight) || averageHeight)) <=
    2;

  const clearContainer = () => {
    if (typeof container.replaceChildren === "function")
      container.replaceChildren();
    else container.textContent = "";
  };

  const unmount = (index: any) => {
    const mountedFloor = mounted.get(index);
    if (!mountedFloor) return;
    mounted.delete(index);
    const measured = Number(mountedFloor.row.offsetHeight);
    if (Number.isFinite(measured) && measured > 0) {
      averageHeight = Math.round((averageHeight * 3 + measured) / 4);
      measuredHeights.set(itemIdentity(items[index]), measured);
      mountedFloor.row.style.minHeight = `${measured}px`;
    }
    try {
      mountedFloor.cleanup?.();
    } finally {
      mountedFloor.scope.dispose();
      mountedFloor.row.replaceChildren?.();
    }
  };

  const mount = async (index: any) => {
    if (destroyed || mounted.has(index) || !items[index]) return;
    const item = items[index];
    const row = rows[index]!;
    const scope = createScope({ container: row, item });
    const mountedFloor = { row, scope, cleanup: null };
    mounted.set(index, mountedFloor);
    try {
      let record = cache?.get(itemIdentity(item));
      if (record === undefined) {
        const request = getRecord(item);
        record = await (typeof scope.wait === "function"
          ? scope.wait(request)
          : request);
        if (!scope.active || destroyed || mounted.get(index) !== mountedFloor)
          return;
        cache?.set(itemIdentity(item), record);
      }
      scope.setRecord?.(record);
      if (floorHtml) {
        row.innerHTML = floorHtmlAssetOriginOffsets === undefined
          ? floorHtml
          : resolveRoleDocumentUrls(floorHtml, floorHtmlUrl, floorHtmlAssetOriginOffsets);
      }
      const result = render({ container: row, item, record, scope });
      const cleanup = await (typeof scope.wait === "function"
        ? scope.wait(Promise.resolve(result))
        : result);
      if (!scope.active || destroyed || mounted.get(index) !== mountedFloor) {
        if (typeof cleanup === "function") cleanup();
        return;
      }
      if (typeof cleanup === "function") mountedFloor.cleanup = cleanup;
    } catch (error) {
      if (scope.active && !destroyed) {
        unmount(index);
        throw error;
      }
    }
  };

  const ensureWindow = async () => {
    if (destroyed) return;
    if (visibleEnd < 0) {
      for (const index of [...mounted.keys()]) unmount(index);
      return;
    }
    const first = Math.max(0, visibleStart - overscan);
    const last = Math.min(items.length - 1, visibleEnd + overscan);
    for (const index of [...mounted.keys()])
      if (index < first || index > last) unmount(index);
    const work = [];
    for (let index = first; index <= last; index += 1) work.push(mount(index));
    await Promise.all(work);
  };

  const appendItem = (item: any) => {
    const row = document.createElement("div");
    row.dataset.floorIndex = String(items.length);
    row.style.minHeight = `${measuredHeights.get(itemIdentity(item)) || averageHeight}px`;
    items.push(item);
    rows.push(row);
    container.append(row);
  };

  async function loadNext(renderWindow: any = true) {
    if (destroyed) return;
    if (loading?.generation === generation) return loading.promise!;
    if (nextCursor === null && !retryRendering) return;
    const expectedGeneration = generation;
    const cursor = nextCursor;
    const token: { generation: number; promise: Promise<void> | null } = {
      generation: expectedGeneration,
      promise: null,
    };
    token.promise = Promise.resolve()
      .then(async () => {
        if (retryRendering) return null;
        return listItems({
          branchId,
          ...(cursor === undefined ? {} : { cursor }),
          limit: pageSize,
        });
      })
      .then(async (page: any) => {
        if (destroyed || expectedGeneration !== generation) return;
        if (page) {
          if (followTail) {
            const anchor = items[visibleStart];
            const offset = anchor
              ? rowTop(visibleStart) - Number(container.scrollTop || 0)
              : 0;
            for (const index of [...mounted.keys()]) unmount(index);
            const previous = items.splice(0);
            rows.length = 0;
            clearContainer();
            for (const item of [...page.items].reverse()) appendItem(item);
            for (const item of previous) appendItem(item);
            if (anchor) {
              const index = items.findIndex(
                (item) => itemIdentity(item) === itemIdentity(anchor),
              );
              container.scrollTop = Math.max(0, rowTop(index) - offset);
            }
            const range = visibleRangeFromDom();
            visibleStart = range.start;
            visibleEnd = range.end;
          } else {
            for (const item of page.items) appendItem(item);
          }
          nextCursor = page.nextCursor;
        }
        if (renderWindow) {
          try {
            await ensureWindow();
            retryRendering = false;
          } catch (error) {
            retryRendering = true;
            throw error;
          }
        }
      })
      .finally(() => {
        if (loading === token) loading = null;
        publish();
      });
    loading = token;
    publish();
    await token.promise;
  }

  const setVisibleRange = async (start: any, end: any) => {
    if (destroyed) return;
    visibleStart = Math.max(0, Math.trunc(start));
    visibleEnd = Math.max(visibleStart, Math.trunc(end));
    await ensureWindow();
  };

  const updateVisibleRange = () => {
    const { start, end } = visibleRangeFromDom();
    if (end < 0) {
      visibleStart = 0;
      visibleEnd = -1;
      background(ensureWindow);
    } else background(() => setVisibleRange(start, end));
  };

  const refresh = async () => {
    if (destroyed) return;
    const atLatest = followTail
      ? isAtBottom()
      : Number(container.scrollTop || 0) <= 2;
    if (items.length && !atLatest) {
      refreshPending = true;
      return;
    }
    refreshPending = false;
    const expectedGeneration = ++generation;
    refreshing = true;
    publish();
    try {
      const page = await listItems({ branchId, limit: pageSize });
      if (destroyed || expectedGeneration !== generation) return;
      for (const index of [...mounted.keys()]) unmount(index);
      items.length = 0;
      rows.length = 0;
      nextCursor = page.nextCursor;
      retryRendering = false;
      loading = null;
      clearContainer();
      for (const item of followTail ? [...page.items].reverse() : page.items)
        appendItem(item);
      visibleStart = 0;
      visibleEnd = 0;

      container.scrollTop = followTail
        ? Math.max(
            0,
            scrollHeight() - (Number(container.clientHeight) || averageHeight),
          )
        : 0;
      const range = visibleRangeFromDom();
      visibleStart = range.start;
      visibleEnd = range.end;
      await ensureWindow();
      if (destroyed || expectedGeneration !== generation) return;
      if (followTail) {
        container.scrollTop = Math.max(
          0,
          scrollHeight() - (Number(container.clientHeight) || averageHeight),
        );
        const renderedRange = visibleRangeFromDom();
        visibleStart = renderedRange.start;
        visibleEnd = renderedRange.end;
        await ensureWindow();
      }
    } finally {
      if (expectedGeneration === generation) refreshing = false;
      publish();
    }
  };

  const onScroll = () => {
    if (refreshing) return;
    if (
      refreshPending &&
      (followTail ? isAtBottom() : Number(container.scrollTop || 0) <= 2)
    ) {
      background(refresh);
      return;
    }
    updateVisibleRange();
    const nearEdge = followTail
      ? visibleStart <= overscan
      : visibleEnd >= items.length - 1 - overscan;
    if (nearEdge && nextCursor !== null && !loading)
      background(() => loadNext(true));
  };
  container.addEventListener?.("scroll", onScroll, { passive: true });
  const view = document.defaultView || globalThis.window;
  view?.addEventListener?.("resize", updateVisibleRange);
  document.addEventListener?.("visibilitychange", updateVisibleRange);
  const detailsAncestors: HTMLDetailsElement[] = [];
  let details = container.closest?.("details") || null;
  while (details) {
    details.addEventListener("toggle", updateVisibleRange);
    detailsAncestors.push(details);
    details = details.parentElement?.closest?.("details") || null;
  }
  const ResizeObserverClass = view?.ResizeObserver || globalThis.ResizeObserver;
  const resizeObserver = ResizeObserverClass
    ? new ResizeObserverClass(updateVisibleRange)
    : null;
  resizeObserver?.observe(container);
  const ready = refresh();

  return {
    ready,
    loadNext: () => loadNext(true),
    setVisibleRange,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      container.removeEventListener?.("scroll", onScroll);
      view?.removeEventListener?.("resize", updateVisibleRange);
      document.removeEventListener?.("visibilitychange", updateVisibleRange);
      for (const details of detailsAncestors)
        details.removeEventListener("toggle", updateVisibleRange);
      resizeObserver?.disconnect();
      for (const index of [...mounted.keys()]) unmount(index);
      measuredHeights.clear();
      clearContainer();
    },
    diagnostics() {
      return Object.freeze({
        items: items.length,
        mounted: mounted.size,
        visibleStart,
        visibleEnd,
        firstVisibleFloorId: items[visibleStart]?.floorId || null,
        lastVisibleFloorId: items[visibleEnd]?.floorId || null,
        followTail,
        cached: cache?.size || 0,
        cacheBytes: cache?.bytes || 0,
        hasNextPage: nextCursor !== null,
      });
    },
  };
}

export function createScriptRuntime({
  root,
  delivery,
  host,
  policy,
  validate,
}: RoleRuntimeOptions) {
  if (!root || !delivery || !host)
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_INPUT_MISSING);
  if (!policy)
    throw new TypeError(apiErrorMessages.ROLE_RUNTIME_POLICY_MISSING);
  if (typeof validate === "function") {
    const policyResult = validate("resourcePolicy", policy);
    if (policyResult === false)
      throw new ScriptRuntimeError(
        "CONFIG_INVALID",
        apiErrorMessages.ROLE_RUNTIME_POLICY_INVALID,
      );
  }
  const historyCache = new BoundedCache(policy.historyCache);
  const settledStreamCache = new BoundedCache(policy.settledStreamCache);
  const diagnosticCache = new BoundedCache(policy.diagnosticsCache);
  const document = root.ownerDocument || globalThis.document;
  const scopes = new Set<ResourceScope>();
  let reportSequence = 0;
  let mounted = false;
  let chatWidget: { destroy(): void } | null = null;
  let shadowRoot: ShadowRoot | HTMLElement;

  const messageFor = (code: string): string =>
    String(apiErrorMessages[code as keyof typeof apiErrorMessages]);
  const runtimeError = (code: string, cause?: unknown) =>
    new ScriptRuntimeError(
      code,
      messageFor(code),
      cause ? { cause } : undefined,
    );

  const asRuntimeError = (error: any, fallbackCode: any) => {
    if (error instanceof ScriptRuntimeError) return error;
    if (error && typeof error.code === "string")
      return new ScriptRuntimeError(
        error.code,
        typeof error.message === "string"
          ? error.message
          : messageFor(error.code),
        { cause: error },
      );
    return runtimeError(fallbackCode, error);
  };

  const report = (error: any) => {
    const normalized: Error & { code?: string } =
      error instanceof Error ? error : new Error(String(error));
    if (normalized.code === "FLOOR_VIEW_DISPOSED") return;
    diagnosticCache.set(String(++reportSequence), {
      name: normalized.name,
      message: normalized.message,
      code: normalized.code || null,
      stack: normalized.stack || null,
    });
    try {
      host.report(normalized);
    } catch {
      // A reporting failure must not replace the original runtime failure.
    }
  };

  const runSafe = (callback: any, ...args: any[]) => {
    try {
      const result = callback(...args);
      if (result && typeof result.then === "function") result.catch(report);
      return result;
    } catch (error) {
      report(error);
      return undefined;
    }
  };

  const check = (name: any, value: any, code: any = "INVALID_REQUEST") => {
    if (typeof validate !== "function") return value;
    let result;
    try {
      result = validate(name, value);
    } catch (error) {
      throw asRuntimeError(error, code);
    }
    if (result === false) throw runtimeError(code);
    return value;
  };

  class ResourceScope {
    domRoot: HTMLElement | ShadowRoot;
    fixedRecord: RoleDisplaySnapshot | null;
    floor: boolean;
    active: boolean;
    cleanups: Set<() => void>;
    pending: Set<{ reject: (reason?: unknown) => void }>;
    counts: Map<string, number>;
    layouts?: Map<string, any>;
    timerEntries?: Set<any>;
    media?: Map<string, any>;
    constructor({ domRoot, fixedRecord = null, floor = false }: any) {
      this.domRoot = domRoot;
      this.fixedRecord = fixedRecord;
      this.floor = floor;
      this.active = true;
      this.cleanups = new Set();
      this.pending = new Set();
      this.counts = new Map();
      scopes.add(this);
    }

    setRecord(record: any) {
      this.fixedRecord = cloneReadonly(record);
    }

    assertActive() {
      if (!this.active) throw runtimeError("FLOOR_VIEW_DISPOSED");
    }

    track(type: any, cleanup: any) {
      this.assertActive();
      let released = false;
      this.counts.set(type, (this.counts.get(type) || 0) + 1);
      const release = () => {
        if (released) return;
        released = true;
        this.cleanups.delete(release);
        this.counts.set(type, Math.max(0, (this.counts.get(type) || 1) - 1));
        cleanup?.();
      };
      this.cleanups.add(release);
      return release;
    }

    wait(promise: any) {
      this.assertActive();
      return new Promise<any>((resolve: any, reject: any) => {
        const pending = { reject };
        this.pending.add(pending);
        Promise.resolve(promise).then(
          (value: any) => {
            this.pending.delete(pending);
            if (this.active) resolve(value);
            else reject(runtimeError("FLOOR_VIEW_DISPOSED"));
          },
          (error: any) => {
            this.pending.delete(pending);
            if (this.active) reject(error);
            else reject(runtimeError("FLOOR_VIEW_DISPOSED"));
          },
        );
      });
    }

    dispose() {
      if (!this.active) return;
      this.active = false;
      for (const pending of this.pending)
        pending.reject(runtimeError("FLOOR_VIEW_DISPOSED"));
      this.pending.clear();
      for (const release of [...this.cleanups].reverse()) {
        try {
          release();
        } catch (error) {
          report(error);
        }
      }
      scopes.delete(this);
    }

    updateVisibility(hidden: any) {
      for (const timer of this.timerEntries || [])
        if (hidden) timer.suspend();
        else timer.resume();
    }
  }

  const visibilityChanged = () => {
    const hidden = document.visibilityState === "hidden";
    for (const scope of scopes) scope.updateVisibility(hidden);
  };
  document.addEventListener("visibilitychange", visibilityChanged);

  const assets = new Map(
    Object.entries(delivery.assets || {}).map(([id, asset]: any) => [
      id,
      Object.freeze({
        id,
        ...asset,
        tags: Object.freeze([...(asset.tags || [])]),
      }),
    ]),
  );
  const readonlyData = cloneReadonly(delivery.data || {});

  const resolveAsset = (id: string, expectedKind?: string) => {
    const asset = assets.get(id);
    if (!asset || (expectedKind && asset.kind !== expectedKind))
      throw runtimeError("ASSET_NOT_FOUND");
    return asset;
  };

  const queryOne = (searchRoot: any, selector: any, code: any) => {
    try {
      const matches = searchRoot.querySelectorAll(selector);
      if (matches.length !== 1) throw runtimeError(code);
      return matches[0];
    } catch (error) {
      throw asRuntimeError(error, code);
    }
  };

  const validCallback = (callback: any, code: any = "INVALID_REQUEST") => {
    if (typeof callback !== "function") throw runtimeError(code);
  };

  const validateElementUpdate = (
    definition: any,
    element: any,
    update: any,
  ) => {
    const validator =
      roleRuntimeValidators[
        `${definition.kind}ElementUpdate` as keyof typeof roleRuntimeValidators
      ];
    if (!validator || !validator(update))
      throw runtimeError("UI_UPDATE_INVALID");
    for (const [property, value] of Object.entries(update)) {
      if (property === "asset") {
        if (typeof value !== "string") throw runtimeError("UI_UPDATE_INVALID");
        try {
          resolveAsset(value, "image");
        } catch (error) {
          throw runtimeError("UI_UPDATE_INVALID", error);
        }
      }
      if (
        property === "min" &&
        definition.kind === "progress" &&
        element.tagName === "PROGRESS"
      ) {
        if (value !== 0) throw runtimeError("UI_UPDATE_INVALID");
        continue;
      }
      if (
        ["alt", "value", "min", "max", "disabled", "checked"].includes(property)
      ) {
        if (!(property in element)) throw runtimeError("UI_UPDATE_INVALID");
      }
    }
  };

  const applyElementUpdate = (definition: any, element: any, update: any) => {
    for (const [property, value] of Object.entries(update)) {
      if (property === "visible") element.hidden = !value;
      else if (property === "classes")
        for (const [className, enabled] of Object.entries(
          value as Record<string, boolean>,
        ))
          element.classList.toggle(className, enabled);
      else if (property === "asset")
        element.src = resolveAsset(value as string, "image").url;
      else if (property === "text") element.textContent = value;
      else if (property === "percent") element.style.width = `${value}%`;
      else if (
        property === "min" &&
        definition.kind === "progress" &&
        element.tagName === "PROGRESS"
      ) {
        // HTMLProgressElement has an implicit minimum of zero.
      } else element[property] = value;
    }
  };

  const createLayout = (scope: any, id: any, registration: any) => {
    scope.assertActive();
    if (typeof id !== "string" || !id || !isObject(registration))
      throw runtimeError("UI_REGISTRATION_INVALID");
    check("layoutRegistration", registration, "UI_REGISTRATION_INVALID");
    if (scope.layouts?.has(id)) throw runtimeError("UI_REGISTRATION_INVALID");
    const layoutRoot = registration.root
      ? queryOne(scope.domRoot, registration.root, "UI_REGISTRATION_INVALID")
      : scope.domRoot;
    const elements = new Map();
    if (
      !isObject(registration.elements) ||
      !Object.keys(registration.elements).length
    )
      throw runtimeError("UI_REGISTRATION_INVALID");
    for (const [elementId, definition] of Object.entries(
      registration.elements,
    )) {
      if (
        !elementId ||
        !isObject(definition) ||
        typeof definition.selector !== "string" ||
        !roleRuntimeValidators[
          `${definition.kind}ElementUpdate` as keyof typeof roleRuntimeValidators
        ]
      )
        throw runtimeError("UI_REGISTRATION_INVALID");
      elements.set(elementId, {
        definition,
        element: queryOne(
          layoutRoot,
          definition.selector,
          "UI_REGISTRATION_INVALID",
        ),
      });
    }
    scope.layouts ||= new Map();
    let active = true;
    const animations = createVisibilityAnimations(runtimeError);
    let bindingRelease: (() => void) | null = null;
    const releases = new Set<() => void>();
    const mountedComponents = new Set<{ destroy(): void }>();
    const getElement = (elementId: string, kind?: string) => {
      const entry = elements.get(elementId);
      if (!entry || (kind && entry.definition.kind !== kind))
        throw runtimeError("UI_REGISTRATION_INVALID");
      return entry.element;
    };
    const removeInternal = () => {
      if (!active) return;
      active = false;
      animations.dispose();
      bindingRelease?.();
      bindingRelease = null;
      for (const release of [...releases]) release();
      releases.clear();
      for (const component of [...mountedComponents]) component.destroy();
      mountedComponents.clear();
      scope.layouts?.delete(id);
    };
    const releaseLayout = scope.track("layouts", removeInternal);
    const layout = {
      update(patch: any) {
        if (!active || !scope.active) return;
        check("layoutPatch", patch, "UI_UPDATE_INVALID");
        if (!isObject(patch)) throw runtimeError("UI_UPDATE_INVALID");
        const operations = [];
        for (const [elementId, update] of Object.entries(patch)) {
          const entry = elements.get(elementId);
          if (!entry) throw runtimeError("UI_UPDATE_INVALID");
          validateElementUpdate(entry.definition, entry.element, update);
          operations.push(() =>
            applyElementUpdate(entry.definition, entry.element, update),
          );
        }
        for (const operation of operations) operation();
      },
      animateVisibility(elementId: any, options: any) {
        try {
          if (!active || !scope.active) throw runtimeError("FLOOR_VIEW_DISPOSED");
          const entry = elements.get(elementId);
          if (!entry || entry.definition.kind !== "container") throw runtimeError("UI_UPDATE_INVALID");
          if (!roleRuntimeValidators.visibilityAnimation(options)) throw runtimeError("UI_UPDATE_INVALID");
          return animations.enqueue(entry.element, options);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      bind(variableScope: any, mapper: any) {
        if (!active || !scope.active) return () => {};
        validCallback(mapper, "UI_UPDATE_INVALID");
        bindingRelease?.();
        const callback = (record: any) => {
          if (!active || !scope.active) return;
          try {
            layout.update(mapper(record));
          } catch (error) {
            report(error);
          }
        };
        bindingRelease = watchVariables(scope, variableScope, callback);
        return () => {
          bindingRelease?.();
          bindingRelease = null;
        };
      },
      on(elementId: any, event: any, handler: any) {
        if (!active || !scope.active) return () => {};
        validCallback(handler);
        if (typeof event !== "string" || !event)
          throw runtimeError("INVALID_REQUEST");
        const element = getElement(elementId);
        const listener = (...args: any[]) => runSafe(handler, ...args);
        element.addEventListener(event, listener);
        const tracked = scope.track("eventListeners", () =>
          element.removeEventListener(event, listener),
        );
        const release = () => {
          releases.delete(release);
          tracked();
        };
        releases.add(release);
        return release;
      },
      remove() {
        releaseLayout();
      },
    };
    Object.defineProperties(layout, {
      _getElement: { value: getElement },
      _scope: { value: scope },
      _active: { get: () => active },
      _trackComponent: {
        value: (component: any) => {
          mountedComponents.add(component);
          return () => mountedComponents.delete(component);
        },
      },
    });
    scope.layouts.set(id, layout);
    return layout;
  };

  const getVariables = (scope: any, variableScope: any) => {
    scope.assertActive();
    if (variableScope !== "current" && variableScope !== "view")
      throw runtimeError("INVALID_REQUEST");
    const record =
      scope.floor && variableScope === "view"
        ? scope.fixedRecord
        : host.get(variableScope);
    check("record", record);
    return cloneReadonly(record);
  };

  const watchVariables = (scope: any, variableScope: any, callback: any) => {
    scope.assertActive();
    validCallback(callback);
    if (variableScope !== "current" && variableScope !== "view")
      throw runtimeError("INVALID_REQUEST");
    let lastSnapshotId: string | undefined;
    const deliver = (record: any) => {
      if (!scope.active) return;
      try {
        check("record", record);
        if (record.snapshotId === lastSnapshotId) return;
        lastSnapshotId = record.snapshotId;
        runSafe(callback, cloneReadonly(record));
      } catch (error) {
        report(error);
      }
    };
    if (scope.floor && variableScope === "view") {
      deliver(scope.fixedRecord);
      return scope.track("subscriptions", () => {});
    }
    const unsubscribe = host.watch(variableScope, deliver);
    return scope.track("subscriptions", unsubscribe);
  };

  const callHost = (
    scope: any,
    paramsName: any,
    resultName: any,
    params: any,
    operation: any,
  ) => {
    try {
      scope.assertActive();
      check(paramsName, params);
    } catch (error) {
      return Promise.reject(error);
    }
    return scope.wait(
      Promise.resolve()
        .then(operation)
        .then((result: any) => {
          check(resultName, result);
          return cloneReadonly(result);
        })
        .catch((error: any) => {
          throw asRuntimeError(error, "RESULT_UNKNOWN");
        }),
    );
  };

  const createApi = (scope: any) => {
    const api = {
      variables: {
        recalculateLatest(params: any) {
          return callHost(scope, "variablesRecalculateLatestParams", "variablesStateOperationResult", params, () => host.recalculateLatest(params));
        },
        restoreMissing(params: any) {
          return callHost(scope, "variablesRestoreMissingParams", "variablesStateOperationResult", params, () => host.restoreMissing(params));
        },
        get: (variableScope: any) => getVariables(scope, variableScope),
        watch: (variableScope: any, callback: any) =>
          watchVariables(scope, variableScope, callback),
        onTurnCommitted(callback: any) {
          scope.assertActive();
          validCallback(callback);
          const unsubscribe = host.onTurnCommitted((event: any) => {
            if (!scope.active) return;
            try {
              check("turnCommit", event);
              runSafe(callback, cloneReadonly(event));
            } catch (error) {
              report(error);
            }
          });
          return scope.track("subscriptions", unsubscribe);
        },
        getSnapshot(snapshotId: any) {
          const params = { snapshotId };
          return callHost(
            scope,
            "variablesGetSnapshotParams",
            "variablesGetSnapshotResult",
            params,
            () => host.getSnapshot(snapshotId),
          );
        },
      },
      messages: {
        listFloors(params: any) {
          return callHost(
            scope,
            "messagesListFloorsParams",
            "messagesListFloorsResult",
            params,
            () => host.listFloors(params),
          );
        },
        getFloor(params: any) {
          return callHost(
            scope,
            "messagesGetFloorParams",
            "messagesGetFloorResult",
            params,
            () => host.getMessages(params),
          );
        },
        onTextStream(callback: any, filter: any = {}) {
          scope.assertActive();
          validCallback(callback);
          check("textStreamFilter", filter);
          const unsubscribe = host.onTextStream((event: any) => {
            if (!scope.active) return;
            try {
              check("textStreamEvent", event);
              if (TERMINAL_STREAM_TYPES.has(event.type)) {
                if (!event.messageId)
                  settledStreamCache.set(event.streamId, event);
              }
              runSafe(callback, cloneReadonly(event));
            } catch (error) {
              report(error);
            }
          }, filter);
          return scope.track("subscriptions", unsubscribe);
        },
      },
      history: {
        select(snapshotId: any) {
          const params = { snapshotId };
          return callHost(
            scope,
            "historySelectParams",
            "historySelectResult",
            params,
            () => host.select(snapshotId),
          );
        },
        latest() {
          return callHost(
            scope,
            "historyLatestParams",
            "historyLatestResult",
            {},
            () => host.latest(),
          );
        },
        listSnapshots(params: any) {
          const normalized = { ...params };
          return callHost(
            scope,
            "historyListSnapshotsParams",
            "historyListSnapshotsResult",
            normalized,
            () => host.listSnapshots(normalized),
          );
        },
      },
      chat: {
        setDraft(text: any) {
          const params = { text };
          return callHost(
            scope,
            "chatSetDraftParams",
            "chatSetDraftResult",
            params,
            () => host.setDraft(text),
          );
        },
        send(params: any) {
          return callHost(
            scope,
            "chatSendParams",
            "chatSendResult",
            params,
            () => host.send(params),
          );
        },
      },
      ui: {
        register: (id: any, registration: any) =>
          createLayout(scope, id, registration),
        mountFloors(layout: any, elementId: any, renderFloor: any) {
          scope.assertActive();
          validCallback(renderFloor);
          if (!delivery.floorHtml)
            throw runtimeError("UI_REGISTRATION_INVALID");
          if (!layout?._active || layout._scope !== scope)
            throw runtimeError("UI_REGISTRATION_INVALID");
          const container = layout._getElement(elementId, "container");
          const branchId = getVariables(scope, "current").branchId;
          const virtualList = mountVirtualList({
            container,
            branchId,
            overscan: policy.overscanFloors,
            floorHtml: delivery.floorHtml,
            floorHtmlUrl: delivery.floorHtmlUrl,
            floorHtmlAssetOriginOffsets: delivery.floorHtmlAssetOriginOffsets,
            cache: historyCache,
            onError: report,
            listItems: (params: any) => api.history.listSnapshots(params),
            itemKey: (item: any) => item.snapshotId,
            getRecord: (item: any) =>
              api.variables.getSnapshot(item.snapshotId),
            createScope: ({ container: floorRoot }: any) =>
              new ResourceScope({ domRoot: floorRoot, floor: true }),
            render: ({ scope: floorScope, record }: any) =>
              renderFloor({
                api: createApi(floorScope),
                record: cloneReadonly(record),
              }),
          });
          const stopRefresh = host.onTurnCommitted(() => {
            if (!scope.active) return;
            virtualList.refresh().catch(report);
          });
          const release = scope.track("floorLists", () => {
            stopRefresh();
            virtualList.destroy();
          });
          return {
            ready: virtualList.ready,
            destroy: release,
            loadNext: virtualList.loadNext,
            setVisibleRange: virtualList.setVisibleRange,
            diagnostics: virtualList.diagnostics,
          };
        },
      },
      assets: {
        url(id: any) {
          scope.assertActive();
          return resolveAsset(id).url;
        },
        list(params: any = {}) {
          scope.assertActive();
          check("assetsListParams", params);
          const result = [...assets.values()]
            .filter((asset: any) => !params.kind || asset.kind === params.kind)
            .filter(
              (asset: any) => !params.tag || asset.tags.includes(params.tag),
            )
            .sort((left: any, right: any) => left.id.localeCompare(right.id))
            .map(({ id, kind, label, tags }: any) => ({
              id,
              kind,
              label,
              tags: [...tags],
            }));
          check("assetsListResult", result);
          return cloneReadonly(result);
        },
      },
      data: {
        get(key: any) {
          scope.assertActive();
          if (typeof key !== "string" || !Object.hasOwn(readonlyData, key))
            throw runtimeError("DATA_NOT_FOUND");
          return readonlyData[key];
        },
      },
      media: {
        async play(params: any) {
          scope.assertActive();
          const normalized = { loop: false, volume: 1, ...params };
          check("mediaPlayParams", normalized);
          const asset = resolveAsset(normalized.asset, "audio");
          scope.media ||= new Map();
          let channel = scope.media.get(normalized.channel);
          if (!channel || channel.asset !== normalized.asset) {
            channel?.release();
            const document = scope.domRoot.ownerDocument || globalThis.document;
            const audio = document.createElement("audio");
            audio.src = asset.url;
            const release = scope.track("media", () => {
              audio.pause();
              audio.removeAttribute?.("src");
              audio.load?.();
              if (scope.media?.get(normalized.channel)?.audio === audio)
                scope.media.delete(normalized.channel);
            });
            channel = { asset: normalized.asset, audio, release };
            scope.media.set(normalized.channel, channel);
          }
          channel.audio.loop = normalized.loop;
          channel.audio.volume = normalized.volume;
          try {
            await scope.wait(channel.audio.play());
            return null;
          } catch (error) {
            if (!scope.active) throw runtimeError("FLOOR_VIEW_DISPOSED");
            channel.release();
            const failure = runtimeError("AUDIO_FAILED", error);
            report(failure);
            throw failure;
          }
        },
        pause(channelName: any) {
          scope.assertActive();
          scope.media?.get(channelName)?.audio.pause();
        },
        stop(channelName: any) {
          scope.assertActive();
          const channel = scope.media?.get(channelName);
          if (!channel) return;
          channel.audio.pause();
          channel.audio.currentTime = 0;
        },
      },
      events: {
        on(target: any, event: any, handler: any) {
          scope.assertActive();
          validCallback(handler);
          if (
            !["window", "document"].includes(target) ||
            typeof event !== "string" ||
            !event
          )
            throw runtimeError("INVALID_REQUEST");
          const document = scope.domRoot.ownerDocument || globalThis.document;
          const eventTarget =
            target === "document" ? document : document.defaultView;
          const listener = (...args: any[]) => runSafe(handler, ...args);
          eventTarget.addEventListener(event, listener);
          return scope.track("eventListeners", () =>
            eventTarget.removeEventListener(event, listener),
          );
        },
      },
      timers: {
        after(ms: any, callback: any) {
          scope.assertActive();
          validCallback(callback);
          check("timerAfterDelay", ms);
          scope.timerEntries ||= new Set();
          let release: () => void;
          const timer = {
            id: null as ReturnType<typeof setTimeout> | null,
            remaining: ms,
            startedAt: 0,
            cancelled: false,
            schedule() {
              if (
                this.cancelled ||
                !scope.active ||
                document.visibilityState === "hidden"
              )
                return;
              this.startedAt = Date.now();
              this.id = setTimeout(() => {
                this.id = null;
                release();
                if (scope.active) runSafe(callback);
              }, this.remaining);
            },
            suspend() {
              if (this.id === null) return;
              clearTimeout(this.id);
              this.id = null;
              this.remaining = Math.max(
                0,
                this.remaining - (Date.now() - this.startedAt),
              );
            },
            resume() {
              if (this.id === null) this.schedule();
            },
          };
          scope.timerEntries.add(timer);
          release = scope.track("timers", () => {
            timer.cancelled = true;
            if (timer.id !== null) clearTimeout(timer.id);
            timer.id = null;
            scope.timerEntries.delete(timer);
          });
          timer.schedule();
          return release;
        },
        every(ms: any, callback: any) {
          scope.assertActive();
          validCallback(callback);
          check("timerEveryDelay", ms);
          scope.timerEntries ||= new Set();
          const timer = {
            id: null as ReturnType<typeof setTimeout> | null,
            cancelled: false,
            schedule() {
              if (
                this.cancelled ||
                !scope.active ||
                document.visibilityState === "hidden"
              )
                return;
              this.id = setInterval(() => {
                if (scope.active) runSafe(callback);
              }, ms);
            },
            suspend() {
              if (this.id === null) return;
              clearInterval(this.id);
              this.id = null;
            },
            resume() {
              if (this.id === null) this.schedule();
            },
          };
          scope.timerEntries.add(timer);
          const release = scope.track("timers", () => {
            timer.cancelled = true;
            if (timer.id !== null) clearInterval(timer.id);
            timer.id = null;
            scope.timerEntries.delete(timer);
          });
          timer.schedule();
          return release;
        },
      },
      widgets: {
        mountChat(layout: any, elementId: any) {
          scope.assertActive();
          if (chatWidget) throw runtimeError("CHAT_ALREADY_MOUNTED");
          if (!layout?._active || layout._scope !== scope)
            throw runtimeError("UI_REGISTRATION_INVALID");
          const element = layout._getElement(elementId, "container");
          const widget = host.mountChat(element);
          let active = true;
          const handle = {
            destroy() {
              if (!active) return;
              active = false;
              widget.destroy();
              if (chatWidget === handle) chatWidget = null;
              untrack();
            },
          };
          const untrackLayout = layout._trackComponent(handle);
          const untrack = scope.track("widgets", () => {
            untrackLayout();
            if (active) {
              active = false;
              widget.destroy();
              if (chatWidget === handle) chatWidget = null;
            }
          });
          chatWidget = handle;
          return handle;
        },
      },
    };
    const implementations = api as Record<string, Record<string, unknown>>;
    const publicApi = Object.fromEntries(
      Object.entries(nativeCardFileRules.frontendModuleApi.methods).map(([namespace, methods]) => [
        namespace,
        Object.freeze(Object.fromEntries(Object.keys(methods).map((method) => {
          const implementation = implementations[namespace]?.[method];
          if (typeof implementation !== "function") {
            throw new TypeError(apiErrorMessages.ROLE_RUNTIME_API_CONFIGURATION_INVALID);
          }
          return [method, implementation];
        }))),
      ]),
    );
    return Object.freeze(publicApi) as typeof api;
  };

  const getDiagnostics = () => {
    const totals: Record<string, number> = {
      layouts: 0,
      subscriptions: 0,
      eventListeners: 0,
      timers: 0,
      media: 0,
      widgets: 0,
      floorLists: 0,
    };
    let floorScopes = 0;
    let pendingOperations = 0;
    for (const scope of scopes) {
      if (scope.floor) floorScopes += 1;
      pendingOperations += scope.pending.size;
      for (const [name, count] of scope.counts)
        totals[name] = (totals[name] || 0) + count;
    }
    return Object.freeze({
      scopes: scopes.size,
      floorScopes,
      pendingOperations,
      ...totals,
      historyCacheEntries: historyCache.size,
      historyCacheBytes: historyCache.bytes,
      settledStreamCacheEntries: settledStreamCache.size,
      settledStreamCacheBytes: settledStreamCache.bytes,
      diagnosticEntries: diagnosticCache.size,
      diagnosticBytes: diagnosticCache.bytes,
    });
  };

  shadowRoot = root.shadowRoot || root.attachShadow?.({ mode: "open" }) || root;
  const pageScope = new ResourceScope({ domRoot: shadowRoot });
  const api = createApi(pageScope);

  return Object.freeze({
    api,
    async mount() {
      pageScope.assertActive();
      if (mounted)
        throw new Error(apiErrorMessages.ROLE_RUNTIME_ALREADY_MOUNTED);
      mounted = true;
      if (delivery.mode === "system_chat") {
        const container = document.createElement("div");
        container.style.height = "100%";
        shadowRoot.append(container);
        const widget = host.mountChat(container);
        pageScope.track("widgets", () => widget.destroy());
        return null;
      }
      if (delivery.cssUrl) {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = delivery.cssUrl;
        shadowRoot.append(style);
      } else {
        const style = document.createElement("style");
        style.textContent = delivery.css;
        shadowRoot.append(style);
      }
      const template = document.createElement("template");
      template.innerHTML = delivery.htmlAssetOriginOffsets === undefined
        ? delivery.html
        : resolveRoleDocumentUrls(delivery.html, delivery.htmlUrl!, delivery.htmlAssetOriginOffsets);
      shadowRoot.append(template.content.cloneNode(true));
      try {
        const entry = await import(/* @vite-ignore */ delivery.scriptUrl);
        pageScope.assertActive();
        if (typeof entry.mount !== "function")
          throw new TypeError(apiErrorMessages.ROLE_RUNTIME_MOUNT_MISSING);
        await entry.mount({ api });
      } catch (error) {
        report(error);
        throw error;
      }
      return null;
    },
    destroy() {
      document.removeEventListener("visibilitychange", visibilityChanged);
      for (const scope of [...scopes]) scope.dispose();
      historyCache.clear();
      settledStreamCache.clear();
      diagnosticCache.clear();
      shadowRoot.replaceChildren();
    },
    getDiagnostics,
    diagnostics: getDiagnostics,
  });
}
