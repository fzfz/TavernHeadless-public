import { describe, expect, it, vi } from "vitest";
import { useRoleNavigation } from "./useRoleNavigation.js";

describe("role workspace navigation", () => {
  it("retains configuration during ordinary navigation and protects replacement", () => {
    const nav = useRoleNavigation({
      resourceDirty: () => false,
      configurationDirty: () => true,
    });
    const open = vi.fn(),
      replace = vi.fn();
    nav.navigate(open);
    expect(open).toHaveBeenCalledOnce();
    nav.navigate(replace, true);
    expect(replace).not.toHaveBeenCalled();
    expect(nav.discardsConfiguration.value).toBe(true);
    nav.cancelNavigation();
    nav.discardAndNavigate();
    expect(replace).not.toHaveBeenCalled();
    nav.navigate(replace, true);
    nav.discardAndNavigate();
    nav.discardAndNavigate();
    expect(replace).toHaveBeenCalledOnce();
  });
  it("protects a resource editor even when configuration is clean", () => {
    const action = vi.fn();
    const nav = useRoleNavigation({
      resourceDirty: () => true,
      configurationDirty: () => false,
    });
    nav.navigate(action);
    expect(action).not.toHaveBeenCalled();
    expect(nav.discardsConfiguration.value).toBe(false);
    nav.discardAndNavigate();
    expect(action).toHaveBeenCalledOnce();
  });
  it("switches immediately when both editors are clean", () => {
    const action = vi.fn();
    const nav = useRoleNavigation({
      resourceDirty: () => false,
      configurationDirty: () => false,
    });
    nav.navigate(action, true);
    expect(action).toHaveBeenCalledOnce();
    expect(nav.pendingNavigation.value).toBeUndefined();
  });
});
