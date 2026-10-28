import type {
  RoleFloorPage,
  RoleMessage,
  RoleRuntimeSession,
  RoleTextEvent,
} from "@tavern/shared";
import type { SessionBranchSummary } from "@tavern/sdk";
import type { ChatAction, ChatFloorContext, ChatState } from "./chat-types.js";
import labels from "../../config/chat-ui.json";
import originalLabels from "../../config/ui.json";
import css from "./chat-widget.css?inline";

export type ChatWidgetOptions = {
  session: RoleRuntimeSession;
  state(): ChatState;
  subscribe(update: () => void): () => void;
  onText(callback: (event: RoleTextEvent) => void): () => void;
  listFloors(query: {
    branchId: string;
    cursor?: string;
  }): Promise<RoleFloorPage>;
  getMessages(floorId: string): Promise<RoleMessage[]>;
  getContext?(floorId: string): Promise<ChatFloorContext>;
  getRevision?(
    messageId: string,
    floorId: string,
  ): Promise<{ revisionNo: number; content: string; hidden: boolean }>;
  listBranches?(): Promise<SessionBranchSummary[]>;
  selectBranch?(branchId: string): void;
  setDraft(text: string): void;
  setEditing(editing: boolean): void;
  send(): Promise<unknown>;
  stop(): void;
  reconcile(): Promise<unknown>;
  retryResponse(): Promise<unknown>;
  retryState(): Promise<unknown>;
  perform?(action: ChatAction): Promise<unknown>;
  report(error: unknown): void;
  editorStorageKey?: string;
  readingStorageKey?: string;
};

export function mountChatWidget(
  element: HTMLElement,
  options: ChatWidgetOptions,
) {
  const document = element.ownerDocument || globalThis.document;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text = "",
  ) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const button = (
    className: string,
    text: string,
    action: () => void | Promise<unknown>,
  ) => {
    const node = create("button", className, text);
    node.type = "button";
    node.onclick = () => action();
    return node;
  };
  const wrapper = create("div");
  element.append(wrapper);
  const shadow = wrapper.attachShadow({ mode: "open" });
  const style = create("style");
  style.textContent = css;
  shadow.append(style);
  const chat = create("section", "chat");
  chat.setAttribute("aria-label", labels.history);
  shadow.append(chat);
  const branchBar = create("label", "branches", labels.branchLabel);
  const branches = create("select");
  branches.setAttribute("aria-label", labels.branchLabel);
  branchBar.append(branches);
  branchBar.hidden = true;
  chat.append(branchBar);
  const status = create("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  chat.append(status);
  const history = create("div", "history");
  history.setAttribute("aria-label", labels.history);
  history.tabIndex = 0;
  const older = button("older-messages", labels.older, async () => {
    await loadMore();
  });
  const historyError = create("p", "history-error");
  historyError.setAttribute("role", "alert");
  historyError.hidden = true;
  const records = create("div", "records"),
    empty = create("p", "empty", labels.empty),
    live = create("div", "live");
  const pendingText = create("p"),
    pendingUser = create("p", "pending-user");
  live.append(pendingText, pendingUser);
  history.append(older, historyError, empty, records, live);
  chat.append(history);
  const latest = button("latest", labels.latest, () => {
    history.scrollTop = history.scrollHeight;
    latest.hidden = true;
  });
  latest.hidden = true;
  chat.append(latest);
  const compose = create("div", "compose"),
    label = create("label");
  const performerName = options.session.delivery.data.performerName;
  label.textContent =
    typeof performerName === "string" && performerName
      ? labels.performerInput.replace("{name}", performerName)
      : labels.input;
  const area = create("textarea");
  area.placeholder = labels.input;
  area.rows = 3;
  label.append(area);
  compose.append(label);
  const failure = create("p", "error");
  failure.setAttribute("role", "alert");
  compose.append(failure);
  const footer = create("footer"),
    help = create("small");
  const mobile = () =>
    globalThis.window?.matchMedia?.("(max-width: 759px)").matches ?? false;
  help.textContent = mobile() ? labels.mobileKeyboard : labels.desktopKeyboard;
  const run = async (operation: () => Promise<unknown>) => {
    failure.textContent = "";
    try {
      await operation();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        failure.textContent =
          error instanceof Error ? error.message : String(error);
    }
  };
  const sendMessage = () => {
    area.focus();
    return run(options.send);
  };
  const send = button("send primary", labels.send, sendMessage);
  send.setAttribute("aria-description", help.textContent);
  const stop = button("stop", labels.stop, options.stop);
  const verify = button("verify", labels.verify, () => run(options.reconcile));
  const retryState = button("retry-state", labels.retryState, () =>
    run(options.retryState),
  );
  const retryResponse = button("retry-response", labels.retryResponse, () =>
    run(options.retryResponse),
  );
  footer.append(help, stop, verify, retryState, retryResponse, send);
  compose.append(footer);
  chat.append(compose);
  let historyFailureKind: "initial" | "older" | null = null;
  let disposed = false,
    loading = false,
    historyLoaded = false,
    contextRevision = 0,
    nextCursor: string | null | undefined,
    generation = 0,
    editingMessageId: string | null = null;
  const floors = new Map<string, RoleMessage[]>(),
    streams = new Map<
      string,
      {
        root: HTMLElement;
        body: HTMLElement;
        label: HTMLElement;
        floorId: string;
        status: string;
      }
    >();
  const transientControls = new Set<HTMLButtonElement>();
  const releaseControls = (root: ParentNode) => {
    for (const control of Array.from(
      root.querySelectorAll<HTMLButtonElement>("button"),
    ))
      transientControls.delete(control);
  };
  const contextRefreshers = new Map<HTMLElement, () => Promise<void>>();
  const messageViews = new WeakMap<HTMLElement, RoleMessage>();
  const pendingMenuFocus = new Map<string, string>();
  const floorNumbers = new Map<string, number>();
  const editPermissions = new Map<
    string,
    { revision: number; allowed: boolean; reason: string }
  >();
  const floorFailures = new Map<string, unknown>();
  const floorReadRequests = new Map<string, number>();
  const readRetryButtons = new Map<string, HTMLButtonElement>();
  let floorReadSerial = 0;
  type FloorRead = {
    floorId: string;
    messages: RoleMessage[];
    error?: unknown;
    failed: boolean;
  };
  const readFloorMessages = async (
    items: { floorId: string }[],
  ): Promise<FloorRead[]> => {
    const results = await Promise.allSettled(
      items.map((floor) => options.getMessages(floor.floorId)),
    );
    return items.map((floor, index) => {
      const result = results[index]!;
      return result.status === "fulfilled"
        ? { floorId: floor.floorId, messages: result.value, failed: false }
        : {
            floorId: floor.floorId,
            messages: floors.get(floor.floorId) ?? [],
            error: result.reason,
            failed: true,
          };
    });
  };
  let candidateFocus: { floorNo: number; direction: string } | null = null;
  type SavedReading = {
    messageId?: string;
    floorId?: string;
    floorNo?: number;
    offset: number;
    atBottom: boolean;
    scrollTop: number;
  };
  let savedReading: SavedReading | null = null;
  let readingRestored = false;
  if (options.readingStorageKey && typeof sessionStorage !== "undefined") {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(options.readingStorageKey) ?? "null",
      );
      if (
        value &&
        typeof value.atBottom === "boolean" &&
        Number.isFinite(value.offset) &&
        Number.isFinite(value.scrollTop)
      )
        savedReading = value;
    } catch {
      /* Reading remains available without browser storage. */
    }
  }
  const readingPosition = () => {
    const bounds = history.getBoundingClientRect();
    const articles = Array.from(
      records.querySelectorAll<HTMLElement>("article"),
    );
    const first = articles.findIndex(
      (article) => article.getBoundingClientRect().bottom > bounds.top,
    );
    const ordered =
      first < 0
        ? articles.reverse()
        : [...articles.slice(first), ...articles.slice(0, first).reverse()];
    return {
      atBottom:
        history.scrollHeight - history.scrollTop - history.clientHeight <= 30,
      scrollTop: history.scrollTop,
      anchors: ordered.map((article) => ({
        id: article.dataset.messageId,
        floorId: article.parentElement?.dataset.floorId,
        floorNo: floorNumbers.get(article.parentElement?.dataset.floorId ?? ""),
        offset: article.getBoundingClientRect().top - bounds.top,
      })),
    };
  };
  const restoreReadingPosition = (
    position: ReturnType<typeof readingPosition>,
  ) => {
    if (position.atBottom) {
      history.scrollTop = history.scrollHeight;
      return;
    }
    const bounds = history.getBoundingClientRect();
    for (const anchor of position.anchors) {
      const article = Array.from(
        records.querySelectorAll<HTMLElement>("article"),
      ).find((item) => item.dataset.messageId === anchor.id);
      if (article) {
        history.scrollTop +=
          article.getBoundingClientRect().top - bounds.top - anchor.offset;
        return;
      }
    }
    history.scrollTop = position.scrollTop;
  };
  const persistReading = () => {
    if (
      !readingRestored ||
      loading ||
      !options.readingStorageKey ||
      typeof sessionStorage === "undefined"
    )
      return;
    const position = readingPosition(),
      anchor = position.anchors[0];
    try {
      sessionStorage.setItem(
        options.readingStorageKey,
        JSON.stringify({
          messageId: anchor?.id,
          floorId: anchor?.floorId,
          floorNo: anchor?.floorNo,
          offset: anchor?.offset ?? 0,
          atBottom: position.atBottom,
          scrollTop: position.scrollTop,
        } satisfies SavedReading),
      );
    } catch {
      /* Keep the current reading position in memory. */
    }
  };
  const restoreCandidateFocus = () => {
    if (!candidateFocus || state().busy) return;
    const article = Array.from(
      records.querySelectorAll<HTMLElement>("article"),
    ).find(
      (node) =>
        Number(node.dataset.floorNo) === candidateFocus!.floorNo &&
        node.dataset.role === "assistant",
    );
    const controls = Array.from(
      article?.querySelectorAll<HTMLButtonElement>(
        "button[data-candidate-direction]",
      ) ?? [],
    );
    if (!controls.length) return;
    const target =
      controls.find(
        (control) =>
          control.dataset.candidateDirection === candidateFocus!.direction &&
          !control.disabled,
      ) ??
      controls.find((control) => !control.disabled) ??
      article?.querySelector<HTMLElement>("summary");
    if (target) {
      target.focus({ preventScroll: true });
      candidateFocus = null;
    }
  };
  let dialog: HTMLDialogElement | null = null;
  let cancelDialog: (() => void) | null = null;
  let finishEditor: (() => void) | null = null;
  let activeEditor: object | null = null;
  let validateEditor: (() => Promise<void>) | null = null;
  let retainActiveEditor: (() => void) | null = null;
  let updateEditorInput: (() => void) | null = null;
  const state = () => options.state();
  const renderState = () => {
    const value = state();
    empty.hidden = floors.size !== 0 || loading || !historyLoaded;
    if (editingMessageId && !value.editing && finishEditor) {
      finishEditor();
      return;
    }
    if (area.value !== value.draft) area.value = value.draft;
    area.disabled = false;
    send.disabled =
      value.busy ||
      value.unknown ||
      value.editing ||
      value.pendingInput !== null ||
      Boolean(value.pendingMain) ||
      !value.draft.trim();
    send.textContent = value.busy ? originalLabels.sendingMessage : labels.send;
    stop.hidden = !value.busy;
    stop.disabled = value.stopping;
    verify.hidden = !value.unknown;
    retryState.hidden = !value.pendingMain;
    retryState.disabled = value.busy;
    retryResponse.hidden =
      value.pendingInput === null ||
      Boolean(value.pendingMain) ||
      value.unknown;
    retryResponse.disabled = value.busy;
    const pendingDisplayed =
      value.pendingMain && floors.has(value.pendingMain.floorId);
    pendingText.textContent = value.pendingMain?.text ?? "";
    pendingText.hidden = !value.pendingMain || Boolean(pendingDisplayed);
    pendingUser.textContent =
      value.pendingInput ?? value.pendingMain?.input ?? "";
    pendingUser.hidden = Boolean(pendingDisplayed) || !pendingUser.textContent;
    status.textContent = value.stopping
      ? labels.stopping
      : value.unknown
        ? labels.unknown
        : value.busy
          ? labels.generating
          : value.notice;
    status.hidden = !status.textContent;
    for (const stream of streams.values()) {
      stream.label.textContent =
        stream.status === "streaming"
          ? labels.generating
          : value.unknown || value.busy || value.pendingMain
            ? labels.unconfirmedOutput
            : labels.unsavedOutput;
    }
    updateEditorInput?.();
    for (const control of transientControls)
      control.disabled =
        control.dataset.unavailable === "true" ||
        value.busy ||
        value.unknown ||
        value.pendingInput !== null ||
        Boolean(value.pendingMain) ||
        (value.editing && control.dataset.editor !== "true");
    branches.disabled = value.busy || value.unknown || value.editing;
    for (const [floorId, control] of readRetryButtons)
      control.disabled = loading || floorReadRequests.has(floorId);
    restoreCandidateFocus();
  };
  const closeDialog = () => {
    dialog?.close();
    dialog?.remove();
    dialog = null;
  };
  const confirm = (
    title: string,
    description: string,
    excerpt: string,
    confirmLabel: string,
    danger = false,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const trigger = shadow.activeElement as HTMLElement | null;
      dialog = create("dialog");
      const heading = create("h2", "", title);
      heading.id = "chat-dialog-title";
      const descriptionNode = create("p", "", description);
      descriptionNode.id = "chat-dialog-description";
      dialog.setAttribute("aria-labelledby", heading.id);
      dialog.setAttribute("aria-describedby", descriptionNode.id);
      const actions = create("div", "actions");
      let resolved = false;
      const finish = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        cancelDialog = null;
        closeDialog();
        trigger?.focus?.();
        resolve(result);
      };
      cancelDialog = () => finish(false);
      const cancel = button("cancel", labels.cancel, () => finish(false));
      actions.append(
        cancel,
        button(danger ? "danger" : "primary", confirmLabel, () => finish(true)),
      );
      dialog.append(heading, descriptionNode);
      if (excerpt) dialog.append(create("p", "excerpt", excerpt));
      dialog.append(actions);
      shadow.append(dialog);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
          const box = dialog!.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            finish(false);
        }
      });
      dialog.showModal();
      cancel.focus();
    });
  const perform = async (action: ChatAction) => {
    if (!options.perform) return;
    if (
      action.kind === "delete" &&
      !(await confirm(
        labels.deleteTitle,
        labels.deleteDescription,
        floors.get(action.floorId)?.find((m) => m.id === action.messageId)
          ?.text ?? "",
        labels.delete,
        true,
      ))
    )
      return;
    if (
      action.kind === "branch" &&
      !(await confirm(
        labels.branchTitle,
        labels.branchDescription,
        "",
        labels.branchConfirm,
      ))
    )
      return;
    if (action.kind === "candidate") {
      const floorNo = floorNumbers.get(action.floorId),
        direction = (shadow.activeElement as HTMLElement | null)?.dataset
          .candidateDirection;
      if (floorNo !== undefined && direction)
        candidateFocus = { floorNo, direction };
    }
    await run(() => options.perform!(action));
    restoreCandidateFocus();
  };
  type EditorDraft = {
    messageId: string;
    floorId: string;
    floorNo?: number;
    text: string;
    expectedRevisionNo?: number;
    baselineText?: string;
    committed?: boolean;
  };
  let editorDraft: EditorDraft | null = null;
  if (options.editorStorageKey && typeof sessionStorage !== "undefined") {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(options.editorStorageKey) ?? "null",
      );
      if (
        saved &&
        typeof saved.messageId === "string" &&
        typeof saved.floorId === "string" &&
        typeof saved.text === "string"
      )
        editorDraft = saved;
    } catch {
      /* The active editor remains available without browser storage. */
    }
  }
  const persistEditor = () => {
    if (options.editorStorageKey && typeof sessionStorage !== "undefined") {
      try {
        if (editorDraft)
          sessionStorage.setItem(
            options.editorStorageKey,
            JSON.stringify(editorDraft),
          );
        else sessionStorage.removeItem(options.editorStorageKey);
      } catch {
        /* Keep the active edit in memory. */
      }
    }
  };
  let editorRecovery: HTMLElement | null = null;
  const showMissingEditor = (missing = true) => {
    if (!editorDraft || editorRecovery) return;
    const recovery = create("section", "editor-recovery"),
      description = create(
        "p",
        "error",
        missing ? labels.editorTargetMissing : labels.editorTargetUnreadable,
      ),
      label = create("label", "", labels.retainedEdit),
      text = create("textarea");
    text.value = editorDraft.text;
    text.readOnly = true;
    text.rows = 4;
    label.append(text);
    recovery.append(
      description,
      label,
      button("", labels.discard, () => {
        editorDraft = null;
        persistEditor();
        recovery.remove();
        editorRecovery = null;
        options.setEditing(false);
        area.focus();
      }),
    );
    compose.insertBefore(recovery, footer);
    editorRecovery = recovery;
    if (!state().editing) options.setEditing(true);
  };
  const editMessage = (
    message: RoleMessage,
    body: HTMLElement,
    restored?: EditorDraft,
    committed = false,
  ) => {
    if (editingMessageId) {
      failure.textContent = labels.editing;
      return;
    }
    editingMessageId = message.id;
    const editorInstance = {};
    activeEditor = editorInstance;
    const ownsEditor = () => !disposed && activeEditor === editorInstance;
    let revisionRequest = 0;
    editorRecovery?.remove();
    editorRecovery = null;
    options.setEditing(true);
    const editor = create("div", "editor"),
      editLabel = create("label", "", labels.edit),
      input = create("textarea");
    input.value = restored?.text ?? message.text;
    let expectedRevisionNo = restored?.expectedRevisionNo;
    let baselineText = restored?.baselineText ?? message.text;
    let revisionReady = !committed && expectedRevisionNo === undefined;
    let revisionInputLocked = !revisionReady,
      saving = false;
    editLabel.append(input);
    editor.append(editLabel);
    const error = create("p", "error");
    error.setAttribute("role", "alert");
    editor.append(error);
    const permissionHint = create("p", "reason");
    permissionHint.setAttribute("role", "status");
    editor.append(permissionHint);
    const permissionAllowsEdit = () => {
      const permission = editPermissions.get(message.floorId);
      return permission?.revision === contextRevision && permission.allowed;
    };
    const actions = create("div", "actions");
    editor.append(actions);
    const remember = () => {
      if (!ownsEditor()) return;
      editorDraft = {
        messageId: message.id,
        floorId: message.floorId,
        floorNo: floorNumbers.get(message.floorId),
        text: input.value,
        expectedRevisionNo,
        baselineText,
        committed,
      };
      persistEditor();
    };
    remember();
    input.oninput = remember;
    const finish = () => {
      if (!ownsEditor()) return;
      activeEditor = null;
      validateEditor = null;
      retainActiveEditor = null;
      updateEditorInput = null;
      finishEditor = null;
      releaseControls(editor);
      editor.remove();
      editingMessageId = null;
      editorDraft = null;
      persistEditor();
      options.setEditing(false);
      renderRecords();
      records
        .querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(message.id)}"] summary`,
        )
        ?.focus();
    };
    finishEditor = finish;
    const cancel = async () => {
      if (
        input.value !== baselineText &&
        !(await confirm(
          labels.discardTitle,
          labels.discardDescription,
          "",
          labels.discard,
        ))
      )
        return;
      finish();
    };
    const save = async () => {
      if (!ownsEditor() || saving) return;
      if (!input.value.trim()) {
        error.textContent = labels.required;
        input.focus();
        return;
      }
      if (!options.perform || state().busy || !revisionReady) return;
      if (state().unknown || !permissionAllowsEdit()) return;
      if (input.value === baselineText) {
        finish();
        return;
      }
      saving = true;
      renderState();
      try {
        await options.perform({
          kind: "edit",
          floorId: message.floorId,
          messageId: message.id,
          text: input.value,
          expectedRevisionNo,
        });
        finish();
      } catch (cause: any) {
        if (!ownsEditor()) return;
        error.textContent =
          cause instanceof Error ? cause.message : String(cause);
        input.focus();
        if (cause.code === "manual_revision_conflict") void readRevision();
      } finally {
        if (ownsEditor()) {
          saving = false;
          renderState();
        }
      }
    };
    const saveButton = button("primary", labels.save, save);
    saveButton.dataset.editor = "true";
    updateEditorInput = () => {
      if (!ownsEditor()) return;
      input.disabled =
        revisionInputLocked || saving || state().busy || state().unknown;
      saveButton.dataset.unavailable = String(
        saving || !revisionReady || !permissionAllowsEdit(),
      );
      saveButton.textContent = saving ? labels.saving : labels.save;
      const permission = editPermissions.get(message.floorId);
      permissionHint.textContent =
        permission?.revision === contextRevision
          ? permission.reason || labels.stateMismatch
          : labels.verifying;
      permissionHint.hidden =
        permissionAllowsEdit() || Boolean(error.textContent);
    };
    const cancelButton = button("", labels.cancel, cancel);
    cancelButton.dataset.editor = "true";
    transientControls.add(saveButton);
    transientControls.add(cancelButton);
    actions.append(cancelButton, saveButton);
    const conflict = create("div", "revision-conflict");
    conflict.setAttribute("role", "alert");
    conflict.hidden = true;
    editor.insertBefore(conflict, actions);
    const applyRevision = (
      latest: { revisionNo: number; content: string },
      keepDraft: boolean,
      focus = true,
    ) => {
      if (!ownsEditor()) return;
      expectedRevisionNo = latest.revisionNo;
      baselineText = latest.content;
      message.text = latest.content;
      body.querySelector<HTMLElement>("p.body")!.textContent = latest.content;
      if (!keepDraft) input.value = latest.content;
      revisionReady = true;
      revisionInputLocked = false;
      conflict.hidden = true;
      error.textContent = "";
      saveButton.dataset.unavailable = "false";
      remember();
      renderState();
      if (focus) input.focus();
    };
    const retainMissing = () => {
      if (!ownsEditor()) return;
      const position = readingPosition();
      const hadEditorFocus =
        (shadow.activeElement as HTMLElement | null)?.closest(".editor") ===
        editor;
      remember();
      activeEditor = null;
      validateEditor = null;
      retainActiveEditor = null;
      updateEditorInput = null;
      finishEditor = null;
      editingMessageId = null;
      releaseControls(editor);
      editor.remove();
      const remaining =
        floors.get(message.floorId)?.filter((item) => item.id !== message.id) ??
        [];
      if (remaining.length) floors.set(message.floorId, remaining);
      else floors.delete(message.floorId);
      renderRecords();
      showMissingEditor();
      if (hadEditorFocus)
        editorRecovery
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus({ preventScroll: true });
      restoreReadingPosition(position);
    };
    retainActiveEditor = retainMissing;
    const readRevision = async (background = false) => {
      if (!options.getRevision || !ownsEditor()) return;
      const request = ++revisionRequest;
      revisionReady = false;
      revisionInputLocked = !background;
      saveButton.dataset.unavailable = "true";
      renderState();
      try {
        const latest = await options.getRevision(message.id, message.floorId);
        if (!ownsEditor() || request !== revisionRequest) return;
        if (latest.hidden) {
          retainMissing();
          return;
        }
        if (
          (expectedRevisionNo !== undefined &&
            expectedRevisionNo !== latest.revisionNo) ||
          (Boolean(restored) && latest.content !== baselineText)
        ) {
          const useSaved = button("", labels.useSaved, () =>
            applyRevision(latest, false),
          );
          const keepDraft = button("", labels.keepDraft, () =>
            applyRevision(latest, true),
          );
          for (const control of [useSaved, keepDraft]) {
            control.dataset.editor = "true";
            transientControls.add(control);
          }
          releaseControls(conflict);
          conflict.replaceChildren(
            create("p", "", labels.revisionChanged),
            create("p", "body", latest.content),
            useSaved,
            keepDraft,
          );
          conflict.hidden = false;
          revisionInputLocked = false;
          renderState();
        } else
          applyRevision(
            latest,
            background || Boolean(restored) || input.value !== baselineText,
            !background,
          );
      } catch (cause) {
        if (!ownsEditor() || request !== revisionRequest) return;
        if ((cause as { status?: number }).status === 404) {
          retainMissing();
          return;
        }
        error.textContent =
          cause instanceof Error ? cause.message : String(cause);
        const retry = button("", labels.retry, () => readRevision(background));
        retry.dataset.editor = "true";
        transientControls.add(retry);
        releaseControls(conflict);
        conflict.replaceChildren(retry);
        conflict.hidden = false;
      }
    };
    validateEditor = () => readRevision(true);
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void cancel();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void save();
      }
    };
    body.append(editor);
    input.focus();
    if (committed || expectedRevisionNo !== undefined) void readRevision();
  };
  const renderMessage = (message: RoleMessage) => {
    const article = create("article", "message");
    article.dataset.messageId = message.id;
    article.dataset.floorNo = String(floorNumbers.get(message.floorId));
    article.dataset.role = message.role;
    const user = message.role === "user",
      data = options.session.delivery.data;
    const assetId = data[user ? "performerAvatar" : "characterAvatar"],
      asset =
        typeof assetId === "string"
          ? options.session.delivery.assets[assetId]
          : undefined;
    const configuredName = data[user ? "performerName" : "characterName"],
      name = typeof configuredName === "string" ? configuredName : "";
    if (asset?.kind === "image" && asset.url) {
      const avatar = create("img", "avatar");
      avatar.src = asset.url;
      avatar.alt = name;
      article.append(avatar);
    } else article.classList.add("no-avatar");
    const body = create("div"),
      messageLabel = [
        name,
        ...(message.role === "agent" ? [originalLabels.supplementLabel] : []),
      ]
        .filter(Boolean)
        .join(" · ");
    if (messageLabel) body.append(create("strong", "name", messageLabel));
    body.append(create("p", "body", message.text));
    article.append(body);
    if (options.perform && options.getContext) {
      const footer = create("div", "message-footer"),
        menu = create("details", "menu"),
        summary = create("summary", "", labels.menu),
        items = create("div", "menu-items");
      items.setAttribute("role", "menu");
      summary.setAttribute("role", "button");
      summary.setAttribute("aria-haspopup", "menu");
      summary.setAttribute("aria-expanded", "false");
      menu.append(summary, items);
      footer.append(menu);
      body.append(footer);
      let loadedRevision = -1,
        contextSerial = 0;
      let contextPending: {
        revision: number;
        generation: number;
        promise: Promise<void>;
      } | null = null;
      let candidateControls: HTMLElement | null = null;
      let previousCandidate: HTMLButtonElement | null = null,
        nextCandidate: HTMLButtonElement | null = null,
        candidateLabel: HTMLElement | null = null;
      const actionControls = new Map<
        string,
        { button: HTMLButtonElement; reason: HTMLElement }
      >();
      const positionMenu = () => {
        const anchor = summary.getBoundingClientRect(),
          height = items.getBoundingClientRect().height,
          width = items.getBoundingClientRect().width;
        items.style.left = `${Math.max(8, Math.min(anchor.left, (globalThis.window?.innerWidth ?? 1000) - width - 8))}px`;
        items.style.top = `${Math.max(8, anchor.top > height + 16 ? anchor.top - height - 8 : Math.min(anchor.bottom + 8, (globalThis.window?.innerHeight ?? 1000) - height - 8))}px`;
      };
      const loadContext = (): Promise<void> => {
        const requestGeneration = generation,
          requestRevision = contextRevision;
        if (loadedRevision === requestRevision) return Promise.resolve();
        if (
          contextPending?.generation === requestGeneration &&
          contextPending.revision === requestRevision
        )
          return contextPending.promise;
        const request = ++contextSerial;
        if (!actionControls.size) items.textContent = labels.verifying;
        const promise = (async () => {
          try {
            const context = await Promise.resolve().then(() =>
              options.getContext!(message.floorId),
            );
            if (
              disposed ||
              request !== contextSerial ||
              requestGeneration !== generation ||
              requestRevision !== contextRevision ||
              !article.isConnected
            )
              return;
            loadedRevision = requestRevision;
            editPermissions.set(message.floorId, {
              revision: requestRevision,
              allowed: context.canEdit,
              reason: context.reason,
            });
            const position = readingPosition();
            const focused = shadow.activeElement as HTMLElement | null;
            const focusedHere = focused?.closest("article") === article;
            if (!actionControls.size) items.replaceChildren();
            const add = (
              text: string,
              allowed: boolean,
              reason: string,
              action: () => void | Promise<unknown>,
            ) => {
              let control = actionControls.get(text);
              if (!control) {
                control = {
                  button: button("", text, () => {}),
                  reason: create("small", "reason"),
                };
                control.button.setAttribute("role", "menuitem");
                transientControls.add(control.button);
                items.append(control.button, control.reason);
                actionControls.set(text, control);
              }
              control.button.onclick = () => {
                menu.open = false;
                return action();
              };
              control.button.dataset.unavailable = String(!allowed);
              control.button.title = allowed ? "" : reason;
              control.reason.textContent = reason;
              control.reason.hidden = allowed || !reason;
            };
            add(labels.edit, context.canEdit, context.reason, () =>
              editMessage(
                message,
                body,
                undefined,
                context.floor.state === "committed",
              ),
            );
            add(labels.delete, context.canDelete, context.reason, () =>
              run(async () => {
                const latest =
                  context.floor.state === "committed"
                    ? await options.getRevision?.(message.id, message.floorId)
                    : undefined;
                if (latest?.hidden) throw new Error(labels.deleteMissing);
                if (latest && latest.content !== message.text) {
                  await refresh();
                  throw new Error(labels.stateMismatch);
                }
                await perform({
                  kind: "delete",
                  floorId: message.floorId,
                  messageId: message.id,
                  expectedRevisionNo: latest?.revisionNo,
                });
              }),
            );
            if (message.role === "assistant") {
              add(
                labels.regenerate,
                context.canGenerate,
                labels.latestOnly,
                () =>
                  perform({
                    kind: "regenerate",
                    floorId: message.floorId,
                    messageId: message.id,
                  }),
              );
              add(labels.continue, context.canGenerate, labels.latestOnly, () =>
                perform({
                  kind: "continue",
                  floorId: message.floorId,
                  messageId: message.id,
                }),
              );
            }
            add(
              labels.branch,
              context.floor.state === "committed",
              context.reason,
              () =>
                perform({
                  kind: "branch",
                  floorId: message.floorId,
                  messageId: message.id,
                }),
            );
            const candidates = context.candidates.items;
            if (message.role === "assistant" && candidates.length > 1) {
              const index = candidates.findIndex(
                (candidate) =>
                  candidate.floorId === context.candidates.activeFloorId,
              );
              if (!candidateControls) {
                candidateControls = create("div", "actions");
                previousCandidate = button("", labels.previous, () => {});
                nextCandidate = button("", labels.next, () => {});
                candidateLabel = create("span");
                previousCandidate.dataset.candidateDirection = "previous";
                nextCandidate.dataset.candidateDirection = "next";
                transientControls.add(previousCandidate);
                transientControls.add(nextCandidate);
                candidateControls.append(
                  previousCandidate,
                  candidateLabel,
                  nextCandidate,
                );
                footer.append(candidateControls);
              }
              for (const [control, direction] of [
                [previousCandidate!, -1],
                [nextCandidate!, 1],
              ] as const) {
                const candidate = candidates[index + direction];
                control.dataset.unavailable = String(
                  !context.candidates.canActivate || !candidate,
                );
                control.onclick = () =>
                  candidate
                    ? perform({
                        kind: "candidate",
                        floorId: message.floorId,
                        candidateFloorId: candidate.floorId,
                      })
                    : undefined;
              }
              candidateLabel!.textContent = labels.candidate
                .replace("{current}", String(index + 1))
                .replace("{total}", String(candidates.length));
            } else if (candidateControls) {
              const active = shadow.activeElement;
              if (active === previousCandidate || active === nextCandidate)
                summary.focus({ preventScroll: true });
              releaseControls(candidateControls);
              candidateControls.remove();
              candidateControls = null;
            }
            renderState();
            positionMenu();
            restoreReadingPosition(position);
            if (
              focusedHere &&
              focused?.tagName === "BUTTON" &&
              (focused as HTMLButtonElement).disabled
            ) {
              Array.from(items.querySelectorAll<HTMLButtonElement>("button"))
                .find((control) => !control.disabled)
                ?.focus({ preventScroll: true });
              if (!shadow.activeElement) summary.focus({ preventScroll: true });
            }
            const desired = pendingMenuFocus.get(message.id);
            if (menu.open && desired) {
              Array.from(items.querySelectorAll<HTMLElement>("[role=menuitem]"))
                .find((item) => item.textContent === desired)
                ?.focus({ preventScroll: true });
              pendingMenuFocus.delete(message.id);
            }
          } catch (cause) {
            if (
              disposed ||
              request !== contextSerial ||
              requestGeneration !== generation ||
              requestRevision !== contextRevision ||
              !article.isConnected
            )
              return;
            for (const control of actionControls.values())
              control.button.dataset.unavailable = "true";
            editPermissions.set(message.floorId, {
              revision: requestRevision,
              allowed: false,
              reason:
                cause instanceof Error ? cause.message : labels.loadFailure,
            });
            releaseControls(items);
            items.replaceChildren(
              create(
                "p",
                "error",
                cause instanceof Error ? cause.message : String(cause),
              ),
            );
            actionControls.clear();
            if (candidateControls) {
              releaseControls(candidateControls);
              candidateControls.remove();
            }
            candidateControls = null;
            renderState();
            if (menu.open) summary.focus({ preventScroll: true });
          } finally {
            if (request === contextSerial) contextPending = null;
          }
        })();
        contextPending = {
          generation: requestGeneration,
          revision: requestRevision,
          promise,
        };
        return promise;
      };
      menu.addEventListener("toggle", () => {
        summary.setAttribute("aria-expanded", String(menu.open));
        if (menu.open) {
          positionMenu();
          void loadContext();
        }
      });
      contextRefreshers.set(menu, loadContext);
      if (message.role === "assistant") void loadContext();
      menu.onkeydown = (event) => {
        if (event.key === "Escape") {
          menu.open = false;
          summary.focus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const controls = Array.from(
          items.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        if (!controls.length) return;
        const index = controls.indexOf(
          shadow.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? controls.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  controls.length) %
                controls.length;
        event.preventDefault();
        controls[next]?.focus();
      };
    }
    messageViews.set(article, { ...message });
    return article;
  };
  const renderRecords = () => {
    if (
      editingMessageId &&
      ![...floors.values()].some((messages) =>
        messages.some((message) => message.id === editingMessageId),
      )
    ) {
      retainActiveEditor?.();
      return;
    }
    const existingRows = new Map(
      Array.from(records.children).map((node) => [
        (node as HTMLElement).dataset.floorId,
        node as HTMLElement,
      ]),
    );
    const active = shadow.activeElement as HTMLElement | null;
    const focusedMessageId = active?.closest<HTMLElement>(
      "article[data-message-id]",
    )?.dataset.messageId;
    const focusedText = active?.textContent;
    const previousMessages = Array.from(
      records.querySelectorAll<HTMLElement>("article"),
    );
    const focusedIndex = previousMessages.findIndex(
      (article) => article.dataset.messageId === focusedMessageId,
    );
    const focusFallbackIds =
      focusedIndex < 0
        ? []
        : [
            ...previousMessages.slice(focusedIndex + 1),
            ...previousMessages.slice(0, focusedIndex).reverse(),
          ].map((article) => article.dataset.messageId);
    const openMenus = new Set(
      Array.from(
        records.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ).map((menu) => menu.closest<HTMLElement>("article")?.dataset.messageId),
    );
    let rowIndex = 0;
    for (const [floorId, messages] of floors) {
      const row = existingRows.get(floorId) ?? create("div");
      row.dataset.floorId = floorId;
      const existingMessages = new Map(
        Array.from(row.children)
          .filter((node) => node.tagName === "ARTICLE")
          .map((node) => [
            (node as HTMLElement).dataset.messageId,
            node as HTMLElement,
          ]),
      );
      let messageIndex = 0;
      for (const message of messages) {
        let article = existingMessages.get(message.id);
        const before = article && messageViews.get(article);
        if (
          !article ||
          (message.id !== editingMessageId &&
            (!before ||
              before.text !== message.text ||
              before.role !== message.role ||
              before.status !== message.status))
        ) {
          if (focusedMessageId === message.id && focusedText)
            pendingMenuFocus.set(message.id, focusedText);
          const previous = article;
          article = renderMessage(message);
          previous?.remove();
          if (openMenus.has(message.id)) {
            const menu = article.querySelector<HTMLDetailsElement>("details");
            if (menu) menu.open = true;
          }
        }
        if (row.children[messageIndex] !== article)
          row.insertBefore(article, row.children[messageIndex] ?? null);
        existingMessages.delete(message.id);
        messageIndex++;
      }
      for (const article of existingMessages.values()) article.remove();
      let readError = row.querySelector<HTMLElement>(".floor-read-error");
      if (floorFailures.has(floorId)) {
        if (!readError) {
          readError = create("div", "floor-read-error");
          const detail = create("p", "error", labels.messageReadFailure),
            retry = button("", labels.retry, () => retryFloor(floorId));
          detail.setAttribute("role", "alert");
          readError.append(detail, retry);
          row.append(readError);
          readRetryButtons.set(floorId, retry);
        }
      } else {
        readError?.remove();
        readRetryButtons.delete(floorId);
      }
      if (records.children[rowIndex] !== row)
        records.insertBefore(row, records.children[rowIndex] ?? null);
      existingRows.delete(floorId);
      rowIndex++;
    }
    for (const row of existingRows.values()) row.remove();
    for (const control of transientControls)
      if (control.isConnected === false) transientControls.delete(control);
    for (const menu of contextRefreshers.keys())
      if (menu.isConnected === false) contextRefreshers.delete(menu);
    for (const [floorId, control] of readRetryButtons)
      if (control.isConnected === false) readRetryButtons.delete(floorId);
    if (active?.isConnected && shadow.activeElement !== active) {
      active.focus({ preventScroll: true });
    } else if (focusedMessageId && !active?.isConnected) {
      const articles = Array.from(
        records.querySelectorAll<HTMLElement>("article"),
      );
      const article =
        articles.find((node) => node.dataset.messageId === focusedMessageId) ??
        focusFallbackIds
          .map((id) => articles.find((node) => node.dataset.messageId === id))
          .find(Boolean);
      const summary = article?.querySelector<HTMLElement>("summary");
      if (summary) summary.focus();
      else if (article) {
        article.tabIndex = -1;
        article.focus();
      } else area.focus();
    }
    if (editorDraft && !editingMessageId) {
      const message = floors
        .get(editorDraft.floorId)
        ?.find((item) => item.id === editorDraft!.messageId);
      const body =
        message &&
        records.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(message.id)}"] > div`,
        );
      if (message && body)
        editMessage(
          message,
          body,
          editorDraft,
          Boolean(editorDraft.committed) ||
            editorDraft.expectedRevisionNo !== undefined,
        );
      else showMissingEditor(!floorFailures.has(editorDraft.floorId));
    }
    renderState();
  };
  async function retryFloor(floorId: string) {
    if (disposed || loading || floorReadRequests.has(floorId)) return;
    const request = generation,
      ticket = ++floorReadSerial,
      focused = shadow.activeElement === readRetryButtons.get(floorId);
    floorReadRequests.set(floorId, ticket);
    renderState();
    try {
      const messages = await options.getMessages(floorId);
      if (
        disposed ||
        request !== generation ||
        floorReadRequests.get(floorId) !== ticket
      )
        return;
      const position = readingPosition();
      floorFailures.delete(floorId);
      if (messages.length) floors.set(floorId, messages);
      else floors.delete(floorId);
      contextRevision++;
      renderRecords();
      restoreReadingPosition(position);
      if (focused) {
        const row = Array.from(records.children).find(
          (node) => (node as HTMLElement).dataset.floorId === floorId,
        );
        (row?.querySelector<HTMLElement>("summary") ?? area).focus({
          preventScroll: true,
        });
      }
      await Promise.all(
        [...contextRefreshers.values()].map((update) => update()),
      );
    } catch (cause) {
      if (
        !disposed &&
        request === generation &&
        floorReadRequests.get(floorId) === ticket
      )
        floorFailures.set(floorId, cause);
    } finally {
      if (
        !disposed &&
        request === generation &&
        floorReadRequests.get(floorId) === ticket
      ) {
        floorReadRequests.delete(floorId);
        renderState();
      }
    }
  }
  const refresh = async () => {
    if (disposed) return;
    const request = ++generation;
    floorReadRequests.clear();
    loading = true;
    renderState();
    older.disabled = true;
    empty.hidden = true;
    try {
      const oldestLoaded = Math.min(
        ...[...floors.keys()].map((id) => floorNumbers.get(id) ?? Infinity),
      );
      let page = await options.listFloors({
        branchId: options.session.branchId,
      });
      if (disposed || request !== generation) return;
      const loadedFloors = [...page.items];
      const restore = readingRestored ? null : savedReading;
      const oldestNeeded = Math.min(
        oldestLoaded,
        restore && !restore.atBottom ? (restore.floorNo ?? Infinity) : Infinity,
        editorDraft?.floorNo ?? Infinity,
      );
      const missingUnboundedTarget = () =>
        [restore && !restore.atBottom ? restore : null, editorDraft].some(
          (target) =>
            target?.floorId &&
            target.floorNo === undefined &&
            !loadedFloors.some((floor) => floor.floorId === target.floorId),
        );
      while (
        page.nextCursor &&
        page.items.length &&
        (Math.min(...page.items.map((item) => item.floorNo)) > oldestNeeded ||
          missingUnboundedTarget())
      ) {
        const cursor = page.nextCursor;
        page = await options.listFloors({
          branchId: options.session.branchId,
          cursor,
        });
        if (disposed || request !== generation) return;
        if (page.nextCursor === cursor) throw new Error(labels.loadFailure);
        loadedFloors.push(...page.items);
      }
      const bundles = await readFloorMessages([...loadedFloors].reverse());
      if (disposed || request !== generation) return;
      const position = readingPosition();
      const hadFailures = floorFailures.size > 0;
      floorFailures.clear();
      for (const result of bundles)
        if (result.failed) floorFailures.set(result.floorId, result.error);
      const merged = bundles
        .filter((result) => result.messages.length > 0 || result.failed)
        .map((result) => [result.floorId, result.messages] as const);
      const previous = [...floors];
      const changed =
        previous.length !== merged.length ||
        merged.some(([id, messages], index) => {
          const old = previous[index];
          return (
            old?.[0] !== id ||
            old[1].length !== messages.length ||
            messages.some((message, n) => {
              const before = old[1][n];
              return (
                !before ||
                before.id !== message.id ||
                before.text !== message.text ||
                before.role !== message.role ||
                before.status !== message.status
              );
            })
          );
        });
      floors.clear();
      for (const [id, messages] of merged) floors.set(id, messages);
      for (const floorId of editPermissions.keys())
        if (!floors.has(floorId)) editPermissions.delete(floorId);
      floorNumbers.clear();
      for (const item of loadedFloors)
        floorNumbers.set(item.floorId, item.floorNo);
      nextCursor = page.nextCursor;
      for (const [id, stream] of streams)
        if (
          floors
            .get(stream.floorId)
            ?.some((message) => message.role === "assistant")
        ) {
          stream.root.remove();
          streams.delete(id);
        }
      historyLoaded = true;
      contextRevision++;
      historyError.hidden = true;
      historyFailureKind = null;
      older.textContent = labels.older;
      if (
        changed ||
        hadFailures ||
        floorFailures.size ||
        !records.children.length
      )
        renderRecords();
      older.hidden = nextCursor === null;
      renderState();
      if (restore && !restore.atBottom) {
        const article =
          Array.from(records.querySelectorAll<HTMLElement>("article")).find(
            (node) => node.dataset.messageId === restore.messageId,
          ) ??
          records.querySelector<HTMLElement>(
            `[data-floor-id="${CSS.escape(restore.floorId ?? "")}"] article`,
          );
        restoreReadingPosition({
          ...restore,
          anchors: article
            ? [
                {
                  id: article.dataset.messageId,
                  offset: restore.offset,
                  floorId: restore.floorId,
                  floorNo: restore.floorNo,
                },
              ]
            : [],
        });
      } else
        restoreReadingPosition(
          restore ? { ...position, atBottom: true } : position,
        );
      readingRestored = true;
      await Promise.all([
        ...[...contextRefreshers.values()].map((update) => update()),
        ...(validateEditor && !state().busy && !state().unknown
          ? [validateEditor()]
          : []),
      ]);
      if (disposed || request !== generation) return;
    } catch (cause) {
      if (!disposed && request === generation) {
        historyFailureKind = "initial";
        historyError.textContent =
          cause instanceof Error ? cause.message : labels.loadFailure;
        historyError.hidden = false;
        older.textContent = labels.retry;
        options.report(cause);
      }
    } finally {
      if (!disposed && request === generation) {
        loading = false;
        older.disabled = false;
        older.hidden = nextCursor === null && historyError.hidden;
        renderState();
        persistReading();
      }
    }
  };
  async function loadMore() {
    if (loading || disposed) return;
    if (historyFailureKind === "initial") {
      historyFailureKind = null;
      await refresh();
      return;
    }
    historyFailureKind = null;
    historyError.hidden = true;
    older.textContent = labels.older;
    if (!nextCursor) return;
    const cursor = nextCursor,
      request = ++generation,
      requestPosition = readingPosition();
    floorReadRequests.clear();
    loading = true;
    renderState();
    older.disabled = true;
    try {
      const page = await options.listFloors({
        branchId: options.session.branchId,
        cursor,
      });
      if (disposed || request !== generation) return;
      const bundles = await readFloorMessages([...page.items].reverse());
      if (disposed || request !== generation) return;
      const position = readingPosition();
      for (const item of page.items)
        floorNumbers.set(item.floorId, item.floorNo);
      for (const result of bundles) {
        if (result.failed) floorFailures.set(result.floorId, result.error);
        else floorFailures.delete(result.floorId);
        if (result.failed || result.messages.length)
          floors.set(result.floorId, result.messages);
        else floors.delete(result.floorId);
      }
      const ordered = [...floors].sort(
        ([a], [b]) => (floorNumbers.get(a) ?? 0) - (floorNumbers.get(b) ?? 0),
      );
      floors.clear();
      for (const [id, messages] of ordered) floors.set(id, messages);
      nextCursor = page.nextCursor;
      contextRevision++;
      renderRecords();
      older.hidden = nextCursor === null;
      restoreReadingPosition(
        position.anchors.length ? position : requestPosition,
      );
      await Promise.all([
        ...[...contextRefreshers.values()].map((update) => update()),
        ...(validateEditor && !state().busy && !state().unknown
          ? [validateEditor()]
          : []),
      ]);
      if (disposed || request !== generation) return;
    } catch (cause) {
      if (disposed || request !== generation) return;
      historyFailureKind = "older";
      historyError.textContent =
        cause instanceof Error ? cause.message : labels.loadFailure;
      historyError.hidden = false;
      older.textContent = labels.retry;
      options.report(cause);
    } finally {
      if (!disposed && request === generation) {
        loading = false;
        older.disabled = false;
        older.hidden = nextCursor === null && historyError.hidden;
        renderState();
        persistReading();
      }
    }
  }
  area.oninput = () => {
    options.setDraft(area.value);
    renderState();
  };
  area.onkeydown = (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.shiftKey
    )
      return;
    if (mobile() && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!send.disabled) void run(options.send);
  };
  history.onscroll = () => {
    persistReading();
    latest.hidden =
      history.scrollHeight - history.scrollTop - history.clientHeight <= 30;
  };
  branches.onchange = () => options.selectBranch?.(branches.value);
  const off = options.subscribe(renderState);
  const offText = options.onText((event) => {
    const atBottom =
      history.scrollHeight - history.scrollTop - history.clientHeight <= 30;
    let node = streams.get(event.streamId);
    if (!node) {
      const root = create("section", "stream-entry"),
        body = create("p", "body"),
        label = create("p", "stream-status");
      root.append(label, body);
      node = {
        root,
        body,
        label,
        floorId: event.floorId,
        status: event.status,
      };
      streams.set(event.streamId, node);
      live.append(root);
    }
    if (event.text || event.status === "streaming")
      node.body.textContent = event.text;
    node.status = event.status;
    if (event.status === "completed" && event.messageId) {
      node.root.remove();
      streams.delete(event.streamId);
    }
    renderState();
    if (atBottom) history.scrollTop = history.scrollHeight;
  });
  if (options.listBranches)
    void options
      .listBranches()
      .then((items) => {
        if (disposed) return;
        branches.replaceChildren();
        for (const item of items) {
          const option = create(
            "option",
            "",
            item.branchId === "main"
              ? labels.mainBranch
              : `${labels.branchPrefix} ${item.branchId}`,
          );
          option.value = item.branchId;
          branches.append(option);
        }
        branches.value = options.session.branchId;
        branchBar.hidden = items.length < 2;
      })
      .catch(options.report);
  const outside = (event: Event) => {
    for (const menu of Array.from(
      shadow.querySelectorAll<HTMLDetailsElement>("details[open]"),
    )) {
      if (!event.composedPath().includes(menu)) menu.open = false;
    }
  };
  document.addEventListener("click", outside);
  const ready = refresh();
  renderState();
  return {
    ready,
    refresh,
    loadNext: loadMore,
    dismissTransient() {
      if (cancelDialog) {
        cancelDialog();
        return true;
      }
      const menu = shadow.querySelector<HTMLDetailsElement>("details[open]");
      if (menu) {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
        return true;
      }
      return false;
    },
    diagnostics: () => ({
      items: floors.size,
      mounted: floors.size,
      followTail: true,
      hasNextPage: nextCursor !== null,
    }),
    destroy() {
      persistReading();
      disposed = true;
      generation++;
      document.removeEventListener("click", outside);
      off();
      offText();
      closeDialog();
      streams.clear();
      floors.clear();
      floorNumbers.clear();
      floorFailures.clear();
      editPermissions.clear();
      floorReadRequests.clear();
      readRetryButtons.clear();
      activeEditor = null;
      validateEditor = null;
      retainActiveEditor = null;
      updateEditorInput = null;
      contextRefreshers.clear();
      pendingMenuFocus.clear();
      transientControls.clear();
      wrapper.remove();
    },
  };
}
