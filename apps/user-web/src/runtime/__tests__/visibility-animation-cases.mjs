import assert from "node:assert/strict";

class AnimationStyle {
  values = new Map();
  getPropertyValue(name) {
    return this.values.get(name)?.[0] ?? "";
  }
  getPropertyPriority(name) {
    return this.values.get(name)?.[1] ?? "";
  }
  setProperty(name, value, priority = "") {
    this.values.set(name, [String(value), priority]);
  }
  removeProperty(name) {
    this.values.delete(name);
  }
}

function setup(buildRuntime, Element) {
  const result = buildRuntime();
  const frames = new Map();
  let now = 0;
  let sequence = 0;
  const view = result.document.defaultView;
  view.performance = { now: () => now };
  view.requestAnimationFrame = (callback) => {
    frames.set(++sequence, callback);
    return sequence;
  };
  view.cancelAnimationFrame = (id) => frames.delete(id);
  view.getComputedStyle = (element) => {
    if (element.failMeasure) throw new Error("neutral measurement failure");
    const inlineDisplay = element.style.getPropertyValue("display");
    const display = element.hidden
      ? "none"
      : inlineDisplay === "revert"
        ? "block"
        : inlineDisplay || element.natural.display;
    const read = (name) => {
      const value = element.style.getPropertyValue(name);
      return value && value !== "auto" ? value : element.natural[name] || "0px";
    };
    return {
      display,
      height: read("height"),
      boxSizing: "content-box",
      getPropertyValue: read,
    };
  };
  const a = new Element(result.document, "div", ["#a"]);
  const b = new Element(result.document, "div", ["#b"]);
  const fill = new Element(result.document, "div", ["#fill"]);
  const text = new Element(result.document, "div", ["#text"]);
  for (const element of [a, b]) {
    element.style = new AnimationStyle();
    element.style.setProperty("display", "none");
    element.style.setProperty("height", "auto");
    element.style.setProperty("padding-top", "10px", "important");
    element.style.setProperty("overflow", "clip");
    element.natural = {
      display: "flex",
      height: "100px",
      "padding-top": "10px",
      "padding-bottom": "20px",
      "margin-top": "3px",
      "margin-bottom": "4px",
    };
  }
  result.shadow.append(a, b, fill, text);
  const layout = result.runtime.api.ui.register("animation", {
    elements: {
      a: { selector: "#a", kind: "container" },
      b: { selector: "#b", kind: "container" },
      fill: { selector: "#fill", kind: "fill" },
      text: { selector: "#text", kind: "text" },
    },
  });
  const step = (time) => {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
  };
  return { ...result, a, b, fill, text, layout, frames, step };
}
const options = (visible, durationMs = 300) => ({
  visible,
  durationMs,
  easing: "swing",
  queue: "append",
});
const code = (expected) => (error) => error.code === expected;

export async function checkVisibilityAndFill(buildRuntime, Element) {
  {
    const { runtime, layout, fill, text } = setup(buildRuntime, Element);
    for (const percent of [0, 25, 50.5, 100, 150]) {
      layout.update({ fill: { percent } });
      assert.equal(fill.style.width, `${percent}%`);
    }
    for (const percent of [-1, NaN, Infinity, -Infinity, "50", null]) {
      assert.throws(
        () => layout.update({ text: { text: "changed" }, fill: { percent } }),
        code("UI_UPDATE_INVALID"),
      );
      assert.equal(fill.style.width, "150%");
      assert.equal(text.textContent, "");
    }
    for (const patch of [
      { text: { percent: 2 } },
      { missing: { percent: 2 } },
      ...["", "invalid token", "a\tb", "a\nb", "a\rb", "a\fb"].map(name => ({a:{classes:{[name]:true}}})),
    ]) {
      assert.throws(
        () => layout.update({ fill: { percent: 7 }, ...patch }),
        code("UI_UPDATE_INVALID"),
      );
      assert.equal(fill.style.width, "150%");
    }
    runtime.destroy();
  }
  {
    const { runtime, layout, a, document } = setup(buildRuntime, Element);
    a.hidden = true;
    a.style.setProperty("display", "inline-flex", "important");
    await layout.animateVisibility("a", options(false, 0));
    assert.equal(a.style.getPropertyValue("display"), "inline-flex");
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.hidden, false);
    assert.equal(a.style.getPropertyValue("display"), "inline-flex");
    assert.equal(a.style.getPropertyPriority("display"), "important");
    a.style.removeProperty("display");
    await layout.animateVisibility("a", options(false, 0));
    a.natural.display = "none";
    await layout.animateVisibility("a", options(true, 0));
    assert.notEqual(document.defaultView.getComputedStyle(a).display, "none");
    runtime.destroy();
  }
  {
    const { runtime, layout, a, frames, step } = setup(buildRuntime, Element);
    const completed = [];
    const show = layout
      .animateVisibility("a", options(true))
      .then(() => completed.push("show"));
    assert.equal(a.style.getPropertyValue("height"), "0px");
    assert.equal(a.style.getPropertyValue("overflow"), "hidden");
    step(150);
    assert.ok(
      Math.abs(parseFloat(a.style.getPropertyValue("height")) - 50) < 0.0001,
    );
    assert.ok(
      Math.abs(parseFloat(a.style.getPropertyValue("padding-top")) - 5) <
        0.0001,
    );
    assert.ok(
      Math.abs(parseFloat(a.style.getPropertyValue("margin-bottom")) - 2) <
        0.0001,
    );
    assert.deepEqual(completed, []);
    step(300);
    await show;
    assert.deepEqual(completed, ["show"]);
    assert.equal(a.style.getPropertyValue("height"), "auto");
    assert.equal(a.style.getPropertyValue("padding-top"), "10px");
    assert.equal(a.style.getPropertyPriority("padding-top"), "important");
    assert.equal(a.style.getPropertyValue("padding-bottom"), "");
    assert.equal(a.style.getPropertyValue("overflow"), "clip");
    assert.equal(a.style.getPropertyValue("display"), "");
    assert.equal(frames.size, 0);
    await layout.animateVisibility("a", options(false, 0));
    assert.equal(a.style.getPropertyValue("display"), "none");
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.style.getPropertyValue("display"), "");
    assert.equal(frames.size, 0);
    runtime.destroy();
  }
  {
    const { runtime, layout, a, b, frames, step } = setup(
      buildRuntime,
      Element,
    );
    const order = [];
    const first = layout
      .animateVisibility("a", options(true))
      .then(() => order.push(1));
    const second = layout
      .animateVisibility("a", options(false))
      .then(() => order.push(2));
    const third = layout
      .animateVisibility("a", options(true))
      .then(() => order.push(3));
    const parallel = layout.animateVisibility("b", options(true, 600));
    assert.equal(frames.size, 2);
    a.natural.height = "200px";
    step(300);
    await first;
    assert.deepEqual(order, [1]);
    assert.equal(
      a.style.getPropertyValue("height"),
      "200px",
      "queued collapse measures when it starts",
    );
    assert.ok(
      Math.abs(parseFloat(b.style.getPropertyValue("height")) - 50) < 0.0001,
    );
    step(450);
    assert.ok(
      Math.abs(parseFloat(a.style.getPropertyValue("height")) - 100) < 0.0001,
    );
    step(600);
    await second;
    await parallel;
    assert.deepEqual(order, [1, 2]);
    assert.equal(a.style.getPropertyValue("height"), "0px");
    step(900);
    await third;
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(frames.size, 0);
    runtime.destroy();
  }
  {
    const { runtime, layout, a, frames } = setup(buildRuntime, Element);
    for (const invalid of [
      { ...options(true), durationMs: -1 },
      { ...options(true), durationMs: 1.5 },
      { ...options(true), durationMs: Infinity },
      { ...options(true), durationMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...options(true), visible: 1 },
      { ...options(true), easing: "linear" },
      { ...options(true), queue: "replace" },
      { ...options(true), complete() {} },
      null,
    ]) {
      await assert.rejects(
        layout.animateVisibility("a", invalid),
        code("UI_UPDATE_INVALID"),
      );
    }
    for (const id of ["missing", "fill", "text", null])
      await assert.rejects(
        layout.animateVisibility(id, options(true)),
        code("UI_UPDATE_INVALID"),
      );
    assert.equal(frames.size, 0);
    assert.equal(a.style.getPropertyValue("display"), "none");
    runtime.destroy();
  }
  for (const dispose of ["layout", "runtime"]) {
    const { runtime, layout, a, frames, step } = setup(buildRuntime, Element);
    const first = layout.animateVisibility("a", options(true));
    const second = layout.animateVisibility("a", options(false));
    const failures = [
      assert.rejects(first, code("FLOOR_VIEW_DISPOSED")),
      assert.rejects(second, code("FLOOR_VIEW_DISPOSED")),
    ];
    step(150);
    if (dispose === "layout") layout.remove();
    else runtime.destroy();
    await Promise.all(failures);
    assert.equal(frames.size, 0);
    assert.equal(a.style.getPropertyValue("height"), "auto");
    assert.equal(a.style.getPropertyValue("overflow"), "clip");
    assert.equal(a.style.getPropertyValue("display"), "none");
    step(1000);
    assert.equal(a.style.getPropertyValue("display"), "none");
    await assert.rejects(
      layout.animateVisibility("a", options(true)),
      code("FLOOR_VIEW_DISPOSED"),
    );
    runtime.destroy();
  }
  {
    const { runtime, layout, a, frames } = setup(buildRuntime, Element);
    a.failMeasure = true;
    await assert.rejects(
      layout.animateVisibility("a", options(true)),
      code("UI_UPDATE_INVALID"),
    );
    assert.equal(a.style.getPropertyValue("display"), "none");
    assert.equal(frames.size, 0);
    a.failMeasure = false;
    a.natural.display = "none";
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.style.getPropertyValue("display"), "revert");
    await layout.animateVisibility("a", options(false, 0));
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.style.getPropertyValue("display"), "revert");
    runtime.destroy();
  }
  {
    const { runtime, layout, a, frames, step } = setup(buildRuntime, Element);
    a.style.setProperty("display", "inline-flex", "important");
    await layout.animateVisibility("a", options(true));
    assert.equal(
      frames.size,
      0,
      "already-visible requests finish without scheduling",
    );
    const hide = layout.animateVisibility("a", options(false));
    step(300);
    await hide;
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.style.getPropertyValue("display"), "inline-flex");
    assert.equal(a.style.getPropertyPriority("display"), "important");
    a.hidden = true;
    await layout.animateVisibility("a", options(true, 0));
    assert.equal(a.hidden, false);
    runtime.destroy();
  }
  {
    const { runtime, layout, a, frames, step } = setup(buildRuntime, Element);
    const request = options(true);
    const first = layout.animateVisibility("a", request);
    request.visible = false;
    request.durationMs = 0;
    step(300);
    await first;
    assert.equal(
      a.style.getPropertyValue("display"),
      "",
      "queued input is copied after validation",
    );
    const original = a.style.setProperty.bind(a.style);
    const second = layout.animateVisibility("a", options(false));
    const failure = assert.rejects(second, code("UI_UPDATE_INVALID"));
    let throwOnce = true;
    a.style.setProperty = (...args) => {
      if (throwOnce && args[0] === "height") {
        throwOnce = false;
        throw new Error("neutral frame failure");
      }
      original(...args);
    };
    step(450);
    await failure;
    assert.equal(a.style.getPropertyValue("height"), "auto");
    assert.equal(a.style.getPropertyValue("display"), "");
    assert.equal(frames.size, 0);
    runtime.destroy();
  }
}
