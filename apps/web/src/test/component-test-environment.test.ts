import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, onBeforeUnmount, onScopeDispose } from "vue";
import { mountComponent } from "./component-host.js";
import { installComponentTestEnvironment } from "./component-test-environment.js";

let originalConstructors: Map<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  originalConstructors = new Map(
    ["Document", "ShadowRoot"].map(
      (name) =>
        [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
    ),
  );
});
afterEach(() => {
  for (const [name, descriptor] of originalConstructors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  vi.restoreAllMocks();
});

function failingComponent(
  phase: "mount" | "beforeUnmount" | "scopeDispose",
  error: Error,
) {
  return defineComponent({
    setup() {
      if (phase === "mount") throw error;
      if (phase === "beforeUnmount")
        onBeforeUnmount(() => {
          throw error;
        });
      if (phase === "scopeDispose")
        onScopeDispose(() => {
          throw error;
        });
      return () => h("div");
    },
  });
}

describe("component test file environment", () => {
  it("installs missing constructors and restores their absence", () => {
    Reflect.deleteProperty(globalThis, "Document");
    Reflect.deleteProperty(globalThis, "ShadowRoot");
    const restore = installComponentTestEnvironment();
    expect(typeof Document).toBe("function");
    expect(typeof ShadowRoot).toBe("function");

    restore();
    expect(Object.hasOwn(globalThis, "Document")).toBe(false);
    expect(Object.hasOwn(globalThis, "ShadowRoot")).toBe(false);
  });

  it.each(["Document", "ShadowRoot"])(
    "preserves an existing %s and its property descriptor",
    (name) => {
      const missing = name === "Document" ? "ShadowRoot" : "Document";
      Reflect.deleteProperty(globalThis, missing);
      const descriptor = {
        configurable: true,
        enumerable: true,
        writable: false,
        value: class NativeConstructor {},
      };
      Object.defineProperty(globalThis, name, descriptor);
      const restore = installComponentTestEnvironment();
      expect(Object.getOwnPropertyDescriptor(globalThis, name)).toEqual(
        descriptor,
      );
      expect(typeof Reflect.get(globalThis, missing)).toBe("function");

      restore();
      expect(Object.getOwnPropertyDescriptor(globalThis, name)).toEqual(
        descriptor,
      );
      expect(Object.hasOwn(globalThis, missing)).toBe(false);
    },
  );

  it("restores the descriptors of undefined constructor properties", () => {
    const documentDescriptor = {
      configurable: true,
      enumerable: true,
      get: () => undefined,
    };
    const shadowRootDescriptor = {
      configurable: true,
      enumerable: true,
      writable: false,
      value: undefined,
    };
    Object.defineProperty(globalThis, "Document", documentDescriptor);
    Object.defineProperty(globalThis, "ShadowRoot", shadowRootDescriptor);
    const restore = installComponentTestEnvironment();
    expect(typeof Document).toBe("function");
    expect(typeof ShadowRoot).toBe("function");

    restore();
    expect(Object.getOwnPropertyDescriptor(globalThis, "Document")).toEqual({
      ...documentDescriptor,
      set: undefined,
    });
    expect(Object.getOwnPropertyDescriptor(globalThis, "ShadowRoot")).toEqual(
      shadowRootDescriptor,
    );
  });

  it("provides constructors before any component is mounted", () => {
    expect(typeof Document).toBe("function");
    expect(typeof ShadowRoot).toBe("function");
  });

  it.each(["mount", "beforeUnmount", "scopeDispose"] as const)(
    "keeps file constructors after a component %s error",
    (phase) => {
      const documentConstructor = Document;
      const shadowRootConstructor = ShadowRoot;
      const error = new Error(`${phase} failed`);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const component = failingComponent(phase, error);
        if (phase === "mount") {
          expect(() => mountComponent(component, {})).toThrow(error);
        } else {
          const host = mountComponent(component, {});
          expect(() => host.unmount()).toThrow(error);
        }
        expect(Document).toBe(documentConstructor);
        expect(ShadowRoot).toBe(shadowRootConstructor);
      } finally {
        warning.mockRestore();
      }
    },
  );
});
