export function mount({ api }) {
  const panel = api.ui.register("turnChanges", {
    elements: {
      change: { selector: "#energy-change", kind: "text" },
      stop: { selector: "#stop-changes", kind: "control" },
      chat: { selector: "#chat", kind: "container" },
    },
  });
  const stop = api.variables.onTurnCommitted((event) => {
    const before = event.before.variables.energy;
    const after = event.after.variables.energy;
    const difference = after - before;
    panel.update({
      change: {
        text: `精力 ${before} → ${after}（${difference > 0 ? "+" : ""}${difference}）`,
      },
    });
  });
  panel.on("stop", "click", () => {
    stop();
    panel.update({ change: { text: "已停止变化提示" } });
  });
  api.widgets.mountChat(panel, "chat");
}
