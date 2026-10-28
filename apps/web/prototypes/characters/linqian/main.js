export function mount({ api }) {
  const status = api.ui.register("status", {
    elements: {
      portrait: { selector: "#status-portrait", kind: "image" },
      place: { selector: "#status-place", kind: "text" },
      date: { selector: "#status-date", kind: "text" },
      time: { selector: "#status-time", kind: "text" },
      affection: { selector: "#status-affection", kind: "text" },
      fall: { selector: "#status-fall", kind: "text" },
      voice: { selector: "#status-voice", kind: "text" },
      affectionBar: { selector: "#status-affection-bar", kind: "progress" },
      fallBar: { selector: "#status-fall-bar", kind: "progress" },
    },
  });
  status.update({ portrait: { asset: "portrait" } });
  const pad = (value) => String(value).padStart(2, "0");
  status.bind("view", ({ variables: v }) => {
    const world = v.世界,
      person = v.林茜;
    const date = world.日期.split("-");
    return {
      place: { text: world.地点 },
      date: {
        text: `${date[0]}年${pad(date[1])}月${pad(date[2])}日 ${world.星期}`,
      },
      time: { text: `${pad(world.小时)}:${pad(world.分钟)} · ${world.时间}` },
      affection: { text: String(Math.round(person.感情)) },
      fall: { text: String(Math.round(person.堕落)) },
      voice: { text: person.内心想法.replace(/^\*\*|\*\*$/g, "") },
      affectionBar: { value: person.感情, min: 0, max: 999 },
      fallBar: { value: person.堕落, min: 0, max: 999 },
    };
  });
  const elements = {
    opening: { selector: "[data-opening]", kind: "text" },
    chat: { selector: "[data-chat]", kind: "container" },
    feedback: { selector: "[data-option-feedback]", kind: "text" },
  };
  for (let i = 0; i < 4; i++) {
    elements["option" + i] = {
      selector: `[data-option="${i}"]`,
      kind: "control",
    };
    elements["text" + i] = {
      selector: `[data-option-text="${i}"]`,
      kind: "text",
    };
  }
  const controls = api.ui.register("controls", { elements });
  controls.update({ opening: { text: api.data.get("opening") } });
  const rules = api.data.get("optionRules");
  let choices = [],
    sending = false;
  const valid = (values) =>
    Array.isArray(values) &&
    values.length === 4 &&
    new Set(values).size === 4 &&
    values.every(
      (value, i) =>
        typeof value === "string" &&
        value.length >= rules.minimumLength &&
        value.length <= rules.maximumLength &&
        !new RegExp(rules.forbiddenPattern).test(value) &&
        value.startsWith(rules.prefixes[i]),
    );
  const refresh = () => {
    const ready = valid(choices),
      patch = {};
    for (let i = 0; i < 4; i++) {
      patch["text" + i] = { text: ready ? choices[i] : "" };
      patch["option" + i] = { disabled: sending || !ready };
    }
    controls.update(patch);
  };
  api.variables.watch("current", ({ variables }) => {
    choices = variables.行动选项;
    refresh();
  });
  for (let i = 0; i < 4; i++)
    controls.on("option" + i, "click", async () => {
      if (sending || !valid(choices)) return;
      const text = choices[i];
      sending = true;
      refresh();
      controls.update({ feedback: { text: "" } });
      try {
        await api.chat.send({ text });
      } catch (error) {
        controls.update({ feedback: { text: error.message } });
      } finally {
        sending = false;
        refresh();
      }
    });
  api.widgets.mountChat(controls, "chat");
}
