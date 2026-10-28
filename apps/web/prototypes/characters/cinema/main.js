export function mount({ api }) {
  const view = api.ui.register("stage", {
    elements: {
      background: { selector: "[data-background]", kind: "image" },
      portrait: { selector: "[data-portrait]", kind: "image" },
      place: { selector: "[data-place]", kind: "text" },
      status: { selector: "[data-status]", kind: "container" },
      state: { selector: "[data-state]", kind: "text" },
      trust: { selector: "[data-trust]", kind: "progress" },
      narration: { selector: "[data-narration]", kind: "container" },
      text: { selector: "[data-text]", kind: "text" },
      page: { selector: "[data-page]", kind: "text" },
      speaker: { selector: "[data-speaker]", kind: "text" },
    },
  });
  const controls = api.ui.register("controls", {
    elements: Object.fromEntries(
      [
        "prev",
        "hide",
        "music",
        "status-toggle",
        "auto",
        "skip",
        "input-open",
        "continue",
        "next",
        "send",
        "close",
        "input",
      ]
        .map((id) => [id, { selector: `[data-${id}]`, kind: "control" }])
        .concat([
          ["panel", { selector: "[data-input-panel]", kind: "container" }],
          ["feedback", { selector: "[data-feedback]", kind: "text" }],
        ]),
    ),
  });
  const scenes = api.data.get("scenes");
  let fullText = api.data.get("opening"),
    page = 0,
    hidden = false,
    statusOpen = false,
    auto = false,
    playing = false,
    input = "",
    stream = null,
    reading = 0;
  function pages() {
    return fullText.split(/\n\s*\n/).filter(Boolean);
  }
  function render() {
    const parts = pages();
    page = Math.max(0, Math.min(page, parts.length - 1));
    view.update({
      text: { text: parts[page] || "" },
      page: { text: parts.length ? `${page + 1} / ${parts.length}` : "" },
    });
    controls.update({
      prev: { disabled: page === 0 },
      next: { disabled: page >= parts.length - 1 },
    });
  }
  view.bind("view", (record) => {
    const v = record.variables;
    return {
      background: { asset: scenes[v["scene.id"]].background },
      portrait: {
        asset: "portrait",
        visible: v["actor.present"],
        classes: { tired: v["actor.fatigue"] > 70 },
      },
      place: { text: scenes[v["scene.id"]].label },
      state: {
        text: `时间 ${v["story.time"]}\n信任 ${v["actor.trust"]}\n体力 ${100 - v["actor.fatigue"]}\n${v["story.clue"]}`,
      },
      trust: { value: v["actor.trust"], max: 100 },
      speaker: { text: api.data.get("characterName") },
    };
  });
  api.variables.watch("view", (record) => {
    const ticket = ++reading;
    if (!record.floorId) {
      fullText = api.data.get("opening");
      page = 0;
      render();
      return;
    }
    api.messages
      .getFloor({
        branchId: record.branchId,
        floorId: record.floorId,
        attemptId: record.attemptId,
      })
      .then((messages) => {
        if (ticket !== reading) return;
        fullText = messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.text)
          .join("\n\n");
        page = 0;
        render();
      })
      .catch((e) => controls.update({ feedback: { text: e.message } }));
  });
  api.messages.onTextStream((event) => {
    if (event.jobId) return;
    if (
      api.variables.get("view").snapshotId !==
      api.variables.get("current").snapshotId
    )
      return;
    reading++;
    if (stream !== event.streamId) {
      stream = event.streamId;
      page = 0;
    }
    fullText = event.text;
    render();
  });
  controls.on("prev", "click", () => {
    page--;
    render();
  });
  controls.on("next", "click", () => {
    page++;
    render();
  });
  controls.on("skip", "click", () => {
    page = pages().length - 1;
    render();
  });
  controls.on("hide", "click", () => {
    hidden = !hidden;
    view.update({ narration: { visible: !hidden } });
    controls.update({ hide: { text: hidden ? "显示" : "隐藏" } });
  });
  controls.on("status-toggle", "click", () => {
    statusOpen = !statusOpen;
    view.update({ status: { visible: statusOpen } });
  });
  controls.on("auto", "click", () => {
    auto = !auto;
    controls.update({ auto: { text: auto ? "Auto ●" : "Auto" } });
  });
  api.timers.every(api.data.get("autoDelayMs"), () => {
    if (auto && page < pages().length - 1) {
      page++;
      render();
    }
  });
  controls.on("input", "input", (event) => {
    input = event.target.value;
  });
  controls.on("input-open", "click", () =>
    controls.update({ panel: { visible: true } }),
  );
  controls.on("close", "click", () =>
    controls.update({ panel: { visible: false } }),
  );
  async function send(text) {
    controls.update({
      send: { disabled: true },
      continue: { disabled: true },
      feedback: { text: "" },
    });
    try {
      await api.history.latest();
      await api.chat.send({ text });
      input = "";
      controls.update({ panel: { visible: false }, input: { value: "" } });
    } catch (e) {
      controls.update({
        panel: { visible: true },
        feedback: { text: e.message },
      });
    } finally {
      controls.update({
        send: { disabled: false },
        continue: { disabled: false },
      });
    }
  }
  controls.on("send", "click", () => {
    if (input.trim()) return send(input);
  });
  controls.on("continue", "click", () => send(api.data.get("continueText")));
  controls.on("music", "click", async () => {
    try {
      if (playing) {
        api.media.pause("bgm");
        playing = false;
      } else {
        await api.media.play({
          asset: api.data.get("music"),
          channel: "bgm",
          loop: true,
          volume: 0.3,
        });
        playing = true;
      }
      controls.update({ music: { text: playing ? "BGM ●" : "BGM" } });
    } catch (e) {
      controls.update({
        panel: { visible: true },
        feedback: { text: e.message },
      });
    }
  });
  render();
}
