// Both browser runtimes use this queue after their shared schema validation.
export function createVisibilityAnimations(runtimeError) {
  const states = new Map();
  let disposed = false;

  const restore = (element, saved) => {
    for (const [name, value, priority] of saved) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  };

  const start = (element, state) => {
    const job = state.jobs[0];
    if (!job || disposed) return;
    const view = element.ownerDocument.defaultView;
    const names = [
      "height",
      "padding-top",
      "padding-bottom",
      "margin-top",
      "margin-bottom",
      "overflow",
      "overflow-x",
      "overflow-y",
    ];
    const saved = names.map((name) => [
      name,
      element.style.getPropertyValue(name),
      element.style.getPropertyPriority(name),
    ]);
    const display = [
      "display",
      element.style.getPropertyValue("display"),
      element.style.getPropertyPriority("display"),
    ];
    const hidden = element.hidden;
    let frame = null;
    let settled = false;
    const reset = () => restore(element, saved);
    const finish = (error, unchanged = false) => {
      if (settled) return;
      settled = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      reset();
      if (error) {
        restore(element, [display]);
        element.hidden = hidden;
        job.reject(error);
      } else {
        if (!job.options.visible && !unchanged)
          element.style.setProperty("display", "none", "important");
        job.resolve();
      }
      state.cancel = null;
      state.jobs.shift();
      start(element, state);
    };
    state.cancel = () => finish(runtimeError("FLOOR_VIEW_DISPOSED"));
    try {
      let computed = view.getComputedStyle(element);
      const wasVisible = !element.hidden && computed.display !== "none";
      if (wasVisible === job.options.visible) {
        finish(undefined, true);
        return;
      }
      if (wasVisible) state.display = display;
      else {
        element.hidden = false;
        if (state.display) restore(element, [state.display]);
        if (view.getComputedStyle(element).display === "none") {
          element.style.removeProperty("display");
          if (view.getComputedStyle(element).display === "none")
            element.style.setProperty("display", "revert", "important");
        }
        state.display = [
          "display",
          element.style.getPropertyValue("display"),
          element.style.getPropertyPriority("display"),
        ];
      }
      computed = view.getComputedStyle(element);
      const pixels = (name) =>
        Number.parseFloat(computed.getPropertyValue(name)) || 0;
      let height = Number.parseFloat(computed.height);
      if (!Number.isFinite(height)) {
        height = element.getBoundingClientRect().height;
        if (computed.boxSizing !== "border-box")
          height -=
            pixels("padding-top") +
            pixels("padding-bottom") +
            pixels("border-top-width") +
            pixels("border-bottom-width");
      }
      const dimensions = [
        Math.max(0, height),
        ...names.slice(1, 5).map(pixels),
      ];
      const writeFrame = (progress) => {
        const swing = 0.5 - Math.cos(progress * Math.PI) / 2;
        const ratio = job.options.visible ? swing : 1 - swing;
        for (let index = 0; index < dimensions.length; index += 1)
          element.style.setProperty(
            names[index],
            `${dimensions[index] * ratio}px`,
            "important",
          );
      };
      if (job.options.durationMs === 0) {
        finish();
        return;
      }
      element.style.setProperty("overflow", "hidden", "important");
      writeFrame(0);
      const began = view.performance.now();
      const tick = (now) => {
        frame = null;
        if (settled || disposed) return;
        try {
          const progress = Math.min(
            1,
            Math.max(0, (now - began) / job.options.durationMs),
          );
          writeFrame(progress);
          if (progress === 1) finish();
          else frame = view.requestAnimationFrame(tick);
        } catch (error) {
          finish(runtimeError("UI_UPDATE_INVALID", error));
        }
      };
      frame = view.requestAnimationFrame(tick);
    } catch (error) {
      finish(runtimeError("UI_UPDATE_INVALID", error));
    }
  };

  return {
    enqueue(element, options) {
      if (disposed) return Promise.reject(runtimeError("FLOOR_VIEW_DISPOSED"));
      let state = states.get(element);
      if (!state) {
        state = { jobs: [], cancel: null, display: null };
        states.set(element, state);
      }
      return new Promise((resolve, reject) => {
        state.jobs.push({ options: { ...options }, resolve, reject });
        if (state.jobs.length === 1) start(element, state);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const state of states.values()) {
        state.cancel?.();
        for (const job of state.jobs)
          job.reject(runtimeError("FLOOR_VIEW_DISPOSED"));
        state.jobs.length = 0;
      }
      states.clear();
    },
  };
}
