export function mount({ api }) {
  const config = api.data.get("ui");
  const status = api.ui.register("status", {
    elements: {
      title: { selector: "#status-title", kind: "text" },
      place: { selector: "#status-place", kind: "text" },
      date: { selector: "#status-date", kind: "text" },
      time: { selector: "#status-time", kind: "text" },
      affection: { selector: "#status-affection", kind: "text" },
      fall: { selector: "#status-fall", kind: "text" },
      affectionBar: { selector: "#status-affection-bar", kind: "progress" },
      fallBar: { selector: "#status-fall-bar", kind: "progress" },
      thought: { selector: "#status-thought", kind: "text" },
    },
  });
  status.update({ title: { text: config.labels.status } });
  const pad = (value) => String(value).padStart(2, "0");
  const displayValue = (value) => {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return config.labels.unavailable;
  };
  status.bind("view", ({ variables }) => {
    const world = variables?.世界;
    const person = variables?.林茜;
    const dateMatch = typeof world?.日期 === "string"
      ? world.日期.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      : null;
    const dateText = dateMatch && typeof world?.星期 === "string"
      ? `${dateMatch[1]}年${dateMatch[2]}月${dateMatch[3]}日 ${world.星期}`
      : config.labels.unavailable;
    const hour = Number.isInteger(world?.小时) && world.小时 >= 0 && world.小时 <= 23
      ? world.小时
      : null;
    const minute = Number.isInteger(world?.分钟) && world.分钟 >= 0 && world.分钟 <= 59
      ? world.分钟
      : null;
    const timeText = hour !== null && minute !== null && typeof world?.时间 === "string"
      ? `${pad(hour)}:${pad(minute)} · ${world.时间}`
      : config.labels.unavailable;
    const affection = typeof person?.感情 === "number" && Number.isFinite(person.感情)
      ? Math.max(0, Math.min(999, person.感情))
      : 0;
    const fall = typeof person?.堕落 === "number" && Number.isFinite(person.堕落)
      ? Math.max(0, Math.min(999, person.堕落))
      : 0;
    return {
      place: { text: displayValue(world?.地点) },
      date: { text: dateText },
      time: { text: timeText },
      affection: { text: displayValue(typeof person?.感情 === "number" ? Math.round(person.感情) : null) },
      fall: { text: displayValue(typeof person?.堕落 === "number" ? Math.round(person.堕落) : null) },
      affectionBar: { value: affection, min: 0, max: 999 },
      fallBar: { value: fall, min: 0, max: 999 },
      thought: { text: typeof person?.内心想法 === "string"
        ? person.内心想法.replace(/^\*\*/, "").replace(/\*\*$/, "")
        : config.labels.unavailable },
    };
  });

  const elements = {
    actionsTitle: { selector: "#actions-title", kind: "text" },
    chat: { selector: "#chat", kind: "container" },
    feedback: { selector: "#action-feedback", kind: "text" },
    repairTitle: { selector: "#repair-title", kind: "text" },
    recalculate: { selector: "#repair-recalculate", kind: "control" },
    recalculateText: { selector: "#repair-recalculate-text", kind: "text" },
    restore: { selector: "#repair-restore", kind: "control" },
    restoreText: { selector: "#repair-restore-text", kind: "text" },
    repairFeedback: { selector: "#repair-feedback", kind: "text" },
  };
  for (let index = 0; index < config.optionCount; index += 1) {
    elements[`option${index}`] = { selector: `#option-${index}`, kind: "control" };
    elements[`text${index}`] = { selector: `#option-text-${index}`, kind: "text" };
  }
  const controls = api.ui.register("actions", { elements });
  controls.update({
    actionsTitle: { text: config.labels.actions },
    repairTitle: { text: config.labels.repair },
    recalculateText: { text: config.labels.recalculate },
    restoreText: { text: config.labels.restore },
  });

  let choices = [];
  let busy = false;
  const validChoices = (values) =>
    Array.isArray(values) &&
    values.length === config.optionCount &&
    new Set(values.map((value) => typeof value === "string" ? value.trim() : "")).size === config.optionCount &&
    values.every((value, index) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      (index !== 0 && index !== config.optionCount - 1 || value.startsWith(config.directivePrefix))
    );
  const refresh = () => {
    const ready = validChoices(choices);
    const patch = {};
    for (let index = 0; index < config.optionCount; index += 1) {
      patch[`text${index}`] = { text: ready ? choices[index] : "" };
      patch[`option${index}`] = { disabled: busy || !ready };
    }
    controls.update(patch);
  };
  api.variables.watch("current", ({ variables }) => {
    choices = variables?.行动选项;
    refresh();
  });
  controls.on("recalculate", "click", async () => {
    if (busy) return;
    const current = api.variables.get("current");
    if (!current || current.floorId === null) {
      controls.update({ repairFeedback: { text: config.labels.noFloor } });
      return;
    }
    busy = true;
    refresh();
    controls.update({
      recalculate: { disabled: true },
      restore: { disabled: true },
      repairFeedback: { text: config.labels.working },
    });
    try {
      await api.variables.recalculateLatest({
        branchId: current.branchId,
        floorId: current.floorId,
        expectedSnapshotId: current.snapshotId,
      });
      controls.update({ repairFeedback: { text: config.labels.recalculateDone } });
    } catch (error) {
      controls.update({ repairFeedback: { text: error?.message || config.labels.sendFailed } });
    } finally {
      busy = false;
      refresh();
      controls.update({ recalculate: { disabled: false }, restore: { disabled: false } });
    }
  });
  controls.on("restore", "click", async () => {
    if (busy) return;
    const current = api.variables.get("current");
    if (!current) {
      controls.update({ repairFeedback: { text: config.labels.sendFailed } });
      return;
    }
    busy = true;
    refresh();
    controls.update({
      recalculate: { disabled: true },
      restore: { disabled: true },
      repairFeedback: { text: config.labels.working },
    });
    try {
      const result = await api.variables.restoreMissing({
        branchId: current.branchId,
        expectedSnapshotId: current.snapshotId,
      });
      controls.update({ repairFeedback: {
        text: result.before.snapshotId === result.after.snapshotId
          ? config.labels.restoreNoChange
          : config.labels.restoreDone,
      } });
    } catch (error) {
      controls.update({ repairFeedback: { text: error?.message || config.labels.sendFailed } });
    } finally {
      busy = false;
      refresh();
      controls.update({ recalculate: { disabled: false }, restore: { disabled: false } });
    }
  });
  for (let index = 0; index < config.optionCount; index += 1) {
    controls.on(`option${index}`, "click", async () => {
      if (busy || !validChoices(choices)) return;
      busy = true;
      refresh();
      controls.update({ recalculate: { disabled: true }, restore: { disabled: true } });
      controls.update({ feedback: { text: "" } });
      try {
        await api.chat.send({ text: choices[index] });
      } catch (error) {
        const message = error && typeof error.message === "string"
          ? error.message
          : config.labels.sendFailed;
        controls.update({ feedback: { text: message } });
      } finally {
        busy = false;
        refresh();
        controls.update({ recalculate: { disabled: false }, restore: { disabled: false } });
      }
    });
  }
  api.widgets.mountChat(controls, "chat");
}
