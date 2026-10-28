import { afterAll, beforeAll } from "vitest";

export function installComponentTestEnvironment() {
  const installed = new Map<string, PropertyDescriptor | undefined>();
  const restore = () => {
    for (const [name, descriptor] of installed) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  try {
    const constructors = {
      Document: class Document {},
      ShadowRoot: class ShadowRoot {},
    };
    for (const [name, constructor] of Object.entries(constructors)) {
      if (typeof Reflect.get(globalThis, name) !== "undefined") continue;
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: constructor,
      });
      installed.set(name, descriptor);
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

let restoreEnvironment: (() => void) | undefined;
beforeAll(() => {
  restoreEnvironment = installComponentTestEnvironment();
});
afterAll(() => {
  restoreEnvironment?.();
});
