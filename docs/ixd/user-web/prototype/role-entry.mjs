export function mount({ api }) {
  const scene = api.data.get("scene");
  const layout = api.ui.register("scene", {
    elements: {
      place: { selector: "#place", kind: "text" },
      time: { selector: "#time", kind: "text" },
      object: { selector: "#object", kind: "text" },
      count: { selector: "#message-count", kind: "text" },
      first: { selector: "#choice-one", kind: "control" },
      second: { selector: "#choice-two", kind: "control" },
      chat: { selector: "#chat-slot", kind: "container" },
    },
  });
  layout.update({
    place: { text: scene.place },
    time: { text: scene.time },
    object: { text: scene.object },
    first: { text: scene.choices[0][0] },
    second: { text: scene.choices[1][0] },
  });
  api.widgets.mountChat(layout, "chat");
  api.variables.watch("view", (snapshot) => {
    layout.update({
      count: { text: `本次演绎共有 ${snapshot.values.messageCount} 条消息` },
    });
  });
  layout.on("first", "click", () => api.chat.setDraft(scene.choices[0][1]));
  layout.on("second", "click", () => api.chat.setDraft(scene.choices[1][1]));
}
