import { describe, expect, it, vi } from "vitest";
import type { DirectiveBinding } from "vue";
import { vModalFocus } from "../../directives/modal-focus.js";
import { createDialogFocusReturn, focusDialogEntry, restoreAsyncActionFocus, type DialogFocusContainer, type DialogFocusTarget } from "./dialog-focus.js";

class FocusTarget {
  isConnected = true;
  focus = vi.fn();
}

describe("native card editor dialog focus", () => {
  it("focuses the first available control when a dialog opens", () => {
    const firstControl = new FocusTarget();
    const dialog = Object.assign(new FocusTarget(), {
      querySelector: vi.fn(() => firstControl),
    }) as unknown as DialogFocusContainer;

    focusDialogEntry(dialog);

    expect(firstControl.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(dialog.focus).not.toHaveBeenCalled();
  });

  it("returns focus to the action that opened the first dialog after a dialog transition", () => {
    const focus = createDialogFocusReturn();
    const trigger = new FocusTarget();
    const intermediateControl = new FocusTarget();
    focus.capture(trigger);
    focus.capture(intermediateControl);

    focus.restore();

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(intermediateControl.focus).not.toHaveBeenCalled();
    expect(focus.hasTarget).toBe(false);
  });

  it("forgets the dialog trigger when navigation focuses a different editor target", () => {
    const focus = createDialogFocusReturn();
    const trigger = new FocusTarget();
    focus.capture(trigger);

    focus.reset();
    focus.restore();

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(focus.hasTarget).toBe(false);
  });

  it("returns focus to a re-enabled async action only when its disabled state lost focus", () => {
    const trigger = new FocusTarget();
    const body = new FocusTarget();
    const elsewhere = new FocusTarget();

    expect(restoreAsyncActionFocus(trigger, body, body)).toBe(true);
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    trigger.focus.mockClear();
    expect(restoreAsyncActionFocus(trigger, elsewhere, body)).toBe(false);
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("wraps Tab and Shift+Tab within the dialog and routes Escape through close", () => {
    const document = { activeElement: null as unknown };
    const makeControl = () => ({
      tabIndex: 0,
      getClientRects: () => [{}],
      matches: () => false,
      focus() { document.activeElement = this; },
    });
    const first = makeControl();
    const last = makeControl();
    const close = vi.fn();
    const dialog = Object.assign(new EventTarget(), {
      tagName: "DIALOG",
      ownerDocument: document,
      querySelectorAll: () => [first, last],
    });
    vModalFocus.beforeMount?.(dialog as unknown as HTMLElement, {
      value: close,
    } as unknown as DirectiveBinding<() => void>, {} as never, null);

    document.activeElement = first;
    const backwards = keyboardEvent("Tab", true);
    dialog.dispatchEvent(backwards);
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    document.activeElement = last;
    const forwards = keyboardEvent("Tab", false);
    dialog.dispatchEvent(forwards);
    expect(forwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const escape = keyboardEvent("Escape", false);
    dialog.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});

function keyboardEvent(key: string, shiftKey: boolean): KeyboardEvent {
  const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
  Object.defineProperties(event, {
    key: { value: key },
    shiftKey: { value: shiftKey },
  });
  return event;
}
