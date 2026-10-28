export interface DialogFocusTarget {
  readonly isConnected: boolean;
  focus(options?: FocusOptions): void;
}

export interface DialogFocusContainer extends DialogFocusTarget {
  querySelector<E extends DialogFocusTarget>(selectors: string): E | null;
}

export function restoreAsyncActionFocus(
  trigger: DialogFocusTarget | null,
  activeElement: DialogFocusTarget | null,
  body: DialogFocusTarget,
): boolean {
  if (!trigger?.isConnected || (activeElement !== trigger && activeElement !== body)) return false;
  trigger.focus({ preventScroll: true });
  return true;
}

export function createDialogFocusReturn() {
  let returnTarget: DialogFocusTarget | null = null;

  return {
    get hasTarget(): boolean {
      return returnTarget !== null;
    },
    capture(target: DialogFocusTarget | null): void {
      if (!returnTarget && target?.isConnected) returnTarget = target;
    },
    restore(): void {
      const target = returnTarget;
      returnTarget = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    },
    reset(): void {
      returnTarget = null;
    },
  };
}

export function focusDialogEntry(dialog: DialogFocusContainer): void {
  const first = dialog.querySelector<DialogFocusTarget>(
    "[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
  );
  (first ?? dialog).focus({ preventScroll: true });
}
