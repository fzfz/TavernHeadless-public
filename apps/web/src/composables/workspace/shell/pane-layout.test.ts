import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspacePaneLayout } from "./pane-layout";

describe("workspace pane resize gestures", () => {
  let browser: EventTarget & { innerWidth: number };
  let classes: Set<string>;
  beforeEach(() => {
    browser = Object.assign(new EventTarget(), { innerWidth: 1400 });
    classes = new Set();
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", {
      body: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  function pointer(type: string, x: number) {
    return Object.assign(new Event(type, { cancelable: true }), {
      clientX: x,
    }) as MouseEvent;
  }
  const options = { centerMin: 500, leftMin: 200, rightMin: 200 };
  it("drags the left pane within limits and releases listeners on mouseup", () => {
    const pane = useWorkspacePaneLayout(options);
    const down = pointer("mousedown", 100);
    pane.beginPaneResize("left", down);
    expect(down.defaultPrevented).toBe(true);
    expect(classes.has("pane-resizing")).toBe(true);
    browser.dispatchEvent(pointer("mousemove", 160));
    expect(pane.paneLayoutStyles.value["--left-pane-width"]).toBe("380px");
    browser.dispatchEvent(pointer("mousemove", 2000));
    expect(pane.leftPaneDesktopWidth.value).toBe(580);
    browser.dispatchEvent(pointer("mousemove", -2000));
    expect(pane.leftPaneDesktopWidth.value).toBe(200);
    browser.dispatchEvent(pointer("mouseup", -2000));
    browser.dispatchEvent(pointer("mousemove", 2000));
    expect(pane.leftPaneDesktopWidth.value).toBe(200);
    expect(classes.size).toBe(0);
  });
  it("drags the right pane with reversed direction and supports explicit cleanup", () => {
    const pane = useWorkspacePaneLayout(options);
    pane.beginPaneResize("right", pointer("mousedown", 100));
    browser.dispatchEvent(pointer("mousemove", 40));
    expect(pane.rightPaneDesktopWidth.value).toBe(380);
    browser.dispatchEvent(pointer("mousemove", -2000));
    expect(pane.rightPaneDesktopWidth.value).toBe(580);
    browser.dispatchEvent(pointer("mousemove", 2000));
    expect(pane.rightPaneDesktopWidth.value).toBe(200);
    pane.stopPaneResize();
    browser.dispatchEvent(pointer("mousemove", 0));
    expect(pane.rightPaneDesktopWidth.value).toBe(200);
    expect(classes.size).toBe(0);
  });
  it("keeps mobile widths unchanged and ignores resize gestures", () => {
    browser.innerWidth = 600;
    const pane = useWorkspacePaneLayout(options);
    const down = pointer("mousedown", 100);
    pane.beginPaneResize("left", down);
    browser.dispatchEvent(pointer("mousemove", 500));
    pane.clampPaneWidths();
    expect(down.defaultPrevented).toBe(false);
    expect(pane.leftPaneDesktopWidth.value).toBe(320);
    expect(classes.size).toBe(0);
  });
  it("resizes by the configured keyboard step, clamps and ignores other keys or mobile", () => {
    const pane = useWorkspacePaneLayout(options);
    const key = (value: string) => Object.assign(new Event("keydown", { cancelable: true }), { key: value }) as KeyboardEvent;
    pane.resizePaneByKeyboard("left", key("ArrowRight"), 7);
    expect(pane.leftPaneDesktopWidth.value).toBe(327);
    pane.resizePaneByKeyboard("right", key("ArrowLeft"), 7);
    expect(pane.rightPaneDesktopWidth.value).toBe(327);
    pane.resizePaneByKeyboard("left", key("ArrowLeft"), 1000);
    expect(pane.leftPaneDesktopWidth.value).toBe(200);
    pane.resizePaneByKeyboard("right", key("ArrowLeft"), 1000);
    expect(pane.rightPaneDesktopWidth.value).toBe(700);
    const ignored = key("Enter");
    pane.resizePaneByKeyboard("left", ignored, 7);
    expect(ignored.defaultPrevented).toBe(false);
    browser.innerWidth = 600;
    pane.resizePaneByKeyboard("left", key("ArrowRight"), 7);
    expect(pane.leftPaneDesktopWidth.value).toBe(200);
  });
  it("clamps desktop widths after the viewport shrinks", () => {
    const pane = useWorkspacePaneLayout(options);
    browser.innerWidth = 1100;
    pane.clampPaneWidths();
    expect(pane.leftPaneDesktopWidth.value).toBe(280);
    expect(pane.rightPaneDesktopWidth.value).toBe(280);
  });
});
