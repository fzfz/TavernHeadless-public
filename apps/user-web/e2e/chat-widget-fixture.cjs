async function mountChatFixture(page, config = {}) {
  await page.evaluate(async (config) => {
    window.fixture?.mounted.destroy();
    document.querySelector("#controlled")?.remove();
    document.querySelector("#app").style.display = "none";
    const { mountChatWidget } =
      await import("/src/features/chat/chat-widget.ts");
    const root = document.createElement("div");
    root.id = "controlled";
    root.style.cssText = "width:1000px;height:760px;margin:30px auto";
    document.body.append(root);
    const rows = new Map(
      Array.from({ length: config.empty ? 0 : 6 }, (_, i) => [
        String(i + 1),
        { floorId: String(i + 1), floorNo: i + 1, state: "committed" },
      ]),
    );
    const state = {
      busy: false,
      unknown: false,
      stopping: false,
      editing: false,
      draft: "",
      notice: "",
      pendingInput: null,
      pendingMain: null,
    };
    const body = (id) =>
      bodyChanges.get(id) ?? `FLOOR ${id}\n` + "已经保存的正文。".repeat(35);
    const contextResponses = [],
      revisionResponses = [],
      editResponses = [],
      messageFailures = new Set(config.messageFailures ?? []),
      bodyChanges = new Map(),
      revisions = new Map();
    const responses = [],
      queries = [],
      reports = [];
    let notify;
    const fixture = {
      rows,
      state,
      responses,
      queries,
      reports,
      active: "6",
      body,
      contextResponses,
      revisionResponses,
      editResponses,
      submissions: [],
      messageFailures,
      bodyChanges,
      revisions,
    };
    const options = {
      session: {
        sessionId: "controlled",
        branchId: "main",
        delivery: { assets: {}, data: {} },
      },
      editorStorageKey: config.storage ? config.storage + ":editor" : undefined,
      readingStorageKey: config.storage
        ? config.storage + ":reading"
        : undefined,
      state: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      onText: () => () => {},
      listFloors: async ({ cursor }) => {
        queries.push(cursor ?? null);
        if (responses.length) return responses.shift();
        const available = [...rows.values()]
          .filter((row) => !cursor || row.floorNo < Number(cursor))
          .sort((a, b) => b.floorNo - a.floorNo);
        return {
          items: available.slice(0, 2),
          nextCursor:
            available.length > 2 ? String(available[1].floorNo) : null,
        };
      },
      getMessages: async (id) => {
        fixture.messageCalls ??= [];
        fixture.messageCalls.push(id);
        if (messageFailures.has(id)) throw new Error("受控消息读取失败");
        return [
          {
            id: "m-" + id,
            floorId: id,
            role: "assistant",
            text: body(id),
            status: "completed",
          },
        ];
      },
      getContext: async (id) => {
        if (contextResponses.length) {
          fixture.blockedContextId = id;
          return contextResponses.shift();
        }
        return fixture.contextFor(id);
      },
      _contextFor: (id) => ({
        floor: rows.get(id),
        pages: [],
        messagePages: {},
        canEdit: !fixture.locked,
        canDelete: !fixture.locked,
        canGenerate: !fixture.locked && id === fixture.active,
        reason: "",
        candidates: {
          activeFloorId: fixture.active,
          canActivate: !fixture.locked && id === fixture.active,
          items:
            id === "6" || id === "60"
              ? [
                  { floorId: "6", pageId: null, text: "A", createdAt: 1 },
                  { floorId: "60", pageId: null, text: "B", createdAt: 2 },
                ]
              : [],
        },
      }),
      getRevision: async (_id, floorId) => {
        if (revisionResponses.length) return revisionResponses.shift();
        return {
          revisionNo: revisions.get(floorId) ?? 0,
          content: body(floorId),
          hidden: !rows.has(floorId),
        };
      },
      setDraft: (text) => {
        state.draft = text;
        notify();
      },
      setEditing: (value) => {
        state.editing = value;
        notify();
      },
      send: async () => {},
      stop() {},
      reconcile: async () => {},
      retryResponse: async () => {},
      retryState: async () => {},
      perform: async (action) => {
        if (action.kind === "edit") {
          fixture.submissions.push({ ...action });
          return editResponses.shift();
        }
        if (action.kind === "candidate") {
          state.busy = true;
          notify();
          rows.delete(fixture.active);
          fixture.active = action.candidateFloorId;
          rows.set(fixture.active, {
            floorId: fixture.active,
            floorNo: 6,
            state: "committed",
          });
          await mounted.refresh();
          state.busy = false;
          notify();
        }
      },
      report: (error) => reports.push(String(error)),
    };
    fixture.contextFor = options._contextFor;
    fixture.options = options;
    const mounted = mountChatWidget(root, options);
    fixture.mounted = mounted;
    fixture.shadow = root.firstElementChild.shadowRoot;
    fixture.notify = () => notify();
    window.fixture = fixture;
    await mounted.ready;
  }, config);
}

module.exports = { mountChatFixture };
