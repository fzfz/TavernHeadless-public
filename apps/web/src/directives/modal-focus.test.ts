import { describe, expect, it, vi } from "vitest";
import { vModalFocus } from "./modal-focus.js";

function fixture(tagName = "DIV") {
  const document = { activeElement: null as unknown };
  const control = (visible = true, disabled = false) => ({
    tabIndex: 0,
    isConnected: true,
    focus: vi.fn(function (this: unknown) {
      document.activeElement = this;
    }),
    matches: () => disabled,
    getClientRects: () => (visible ? [{}] : []),
  });
  const trigger = control();
  document.activeElement = trigger;
  const first = control(),
    hidden = control(false),
    disabled = control(true, true),
    last = control();
  const element = Object.assign(new EventTarget(), {
    tagName,
    ownerDocument: document,
    querySelectorAll: () => [first, hidden, disabled, last],
    focus: vi.fn(),
  });
  const cancel = vi.fn();
  const hooks = vModalFocus as unknown as {
    beforeMount: (element: unknown, binding: { value: () => void }) => void;
    mounted: (element: unknown) => void;
    unmounted: (element: unknown) => void;
  };
  hooks.beforeMount!(element, { value: cancel });
  hooks.mounted!(element);
  const press = (key: string, shiftKey = false) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key,
      shiftKey,
    });
    element.dispatchEvent(event);
    return event;
  };
  return {
    document,
    first,
    last,
    trigger,
    element,
    cancel,
    press,
    close: () => hooks.unmounted!(element),
  };
}

describe("modal keyboard focus", () => {
  it("focuses the first visible enabled control and cycles both boundaries", () => {
    const view = fixture();
    expect(view.document.activeElement).toBe(view.first);
    expect(view.press("Tab", true).defaultPrevented).toBe(true);
    expect(view.document.activeElement).toBe(view.last);
    expect(view.press("Tab").defaultPrevented).toBe(true);
    expect(view.document.activeElement).toBe(view.first);
    expect(view.press("Tab").defaultPrevented).toBe(false);
    view.close();
    expect(view.document.activeElement).toBe(view.trigger);
  });
  it("cancels on Escape and removes the handler when closed", () => {
    const view = fixture();
    expect(view.press("Escape").defaultPrevented).toBe(true);
    expect(view.cancel).toHaveBeenCalledTimes(1);
    view.close();
    view.press("Escape");
    expect(view.cancel).toHaveBeenCalledTimes(1);
  });
  it("lets native dialogs set initial focus and ignores a removed trigger", () => {
    const view = fixture("DIALOG");
    expect(view.first.focus).not.toHaveBeenCalled();
    view.trigger.isConnected = false;
    view.close();
    expect(view.trigger.focus).not.toHaveBeenCalled();
  });
  it("keeps Tab inside a dialog while all controls are unavailable", () => {
    const view = fixture();
    view.element.querySelectorAll = () => [];
    expect(view.press("Tab").defaultPrevented).toBe(true);
    expect(view.element.focus).toHaveBeenCalledOnce();
    view.close();
  });
});
