export function mount({ api }) {
  const scene = api.ui.register("scene", {
    elements: {
      background: { selector: "[data-background]", kind: "image" },
      portrait: { selector: "[data-portrait]", kind: "image" },
      location: { selector: "[data-location]", kind: "text" },
      title: { selector: "[data-scene-title]", kind: "text" },
      clock: { selector: "[data-clock]", kind: "text" },
      trust: { selector: "[data-trust]", kind: "text" },
      energy: { selector: "[data-energy]", kind: "text" },
      clue: { selector: "[data-clue]", kind: "text" },
      progress: { selector: "[data-progress]", kind: "progress" },
      status: { selector: "[data-status-panel]", kind: "container" },
    },
  });
  const controls = api.ui.register("controls", {
    elements: {
      a: { selector: "[data-choice-a]", kind: "control" },
      b: { selector: "[data-choice-b]", kind: "control" },
      music: { selector: "[data-music]", kind: "control" },
      toggle: { selector: "[data-toggle]", kind: "control" },
      feedback: { selector: "[data-feedback]", kind: "text" },
      live: { selector: "[data-live]", kind: "text" },
      agent: { selector: "[data-agent]", kind: "text" },
      chat: { selector: "[data-chat]", kind: "container" },
      floors: { selector: "[data-floors]", kind: "container" },
    },
  });
  const scenes = api.data.get("scenes"),
    choices = api.data.get("choices");
  scene.bind("view", (record) => {
    const v = record.variables,
      place = scenes[v["scene.id"]];
    const energy = Math.max(0, 100 - v["actor.fatigue"]);
    return {
      background: { asset: place.background },
      portrait: {
        asset: "portrait",
        visible: v["actor.present"],
        classes: { tired: energy < 30 && v["actor.trust"] > 40 },
      },
      location: { text: place.label },
      title: { text: place.label + " · " + v["story.time"] },
      clock: { text: v["story.time"] },
      trust: { text: String(v["actor.trust"]) },
      energy: { text: String(energy) },
      clue: { text: v["story.clue"] },
      progress: { value: v["actor.trust"], min: 0, max: 100 },
    };
  });
  let currentChoices = [...choices];
  controls.bind("current", (record) => {
    currentChoices = [
      choices[0],
      record.variables["actor.trust"] >= 50 ? choices[1] : "先听听她的想法",
    ];
    return {
      a: { text: choices[0] },
      b: {
        text: currentChoices[1],
      },
    };
  });
  let expanded = true,
    playing = false;
  controls.on("toggle", "click", () => {
    expanded = !expanded;
    scene.update({ status: { visible: expanded } });
    controls.update({ toggle: { text: expanded ? "收起状态" : "展开状态" } });
  });
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
      controls.update({
        music: { text: playing ? "♫ 暂停音乐" : "♫ 环境音" },
        feedback: { text: "" },
      });
    } catch (e) {
      controls.update({ feedback: { text: e.message } });
    }
  });
  for (const [id, index] of [
    ["a", 0],
    ["b", 1],
  ])
    controls.on(id, "click", async () => {
      controls.update({
        a: { disabled: true },
        b: { disabled: true },
        feedback: { text: "" },
      });
      try {
        await api.chat.send({ text: currentChoices[index] });
      } catch (e) {
        controls.update({ feedback: { text: e.message } });
      } finally {
        controls.update({ a: { disabled: false }, b: { disabled: false } });
      }
    });
  let outputRevision = 0;
  api.variables.watch("current", (record) => {
    const revision = ++outputRevision;
    if (!record.floorId) return;
    api.messages
      .getFloor({
        branchId: record.branchId,
        floorId: record.floorId,
        attemptId: record.attemptId,
      })
      .then((messages) => {
        if (revision !== outputRevision) return;
        controls.update({
          live: {
            text: messages
              .filter((m) => m.role === "assistant")
              .map((m) => m.text)
              .join("\n"),
          },
          agent: {
            text: messages
              .filter((m) => m.role === "agent")
              .map((m) => m.text)
              .join("\n"),
          },
        });
      })
      .catch((error) => controls.update({ feedback: { text: error.message } }));
  });
  api.messages.onTextStream((event) => {
    outputRevision++;
    controls.update({ [event.jobId ? "agent" : "live"]: { text: event.text } });
  });
  api.variables.onTurnCommitted(({ before, after }) => {
    const diff =
      after.variables["actor.trust"] - before.variables["actor.trust"];
    controls.update({ feedback: { text: diff > 0 ? "信任 +" + diff : "" } });
  });
  api.widgets.mountChat(controls, "chat");
  api.ui.mountFloors(controls, "floors", ({ api: floorApi, record }) => {
    const row = floorApi.ui.register("row", {
      elements: {
        title: { selector: "[data-floor-title]", kind: "text" },
        state: { selector: "[data-floor-state]", kind: "text" },
        revisit: { selector: "[data-revisit]", kind: "control" },
      },
    });
    row.bind("view", (r) => ({
      title: {
        text:
          r.variables["story.time"] +
          " · " +
          scenes[r.variables["scene.id"]].label,
      },
      state: {
        text:
          "信任 " +
          r.variables["actor.trust"] +
          " · " +
          r.variables["story.clue"],
      },
    }));
    row.on("revisit", "click", () =>
      floorApi.history.select(record.snapshotId),
    );
  });
}
