import { describe, expect, it } from "vitest";
import { roleResourceImportAction } from "./role-resource-import.js";

describe("role resource import entry points", () => {
  it("does not expose character JSON or ZIP import in the legacy resource form", () => {
    expect(roleResourceImportAction("character")).toEqual({ type: "none" });
  });

  it("retains JSON import for worldbooks and regex resources", () => {
    expect(roleResourceImportAction("worldbook")).toEqual({ type: "json-file" });
    expect(roleResourceImportAction("regex")).toEqual({ type: "json-file" });
  });

  it("keeps import disabled for model and persona resources", () => {
    expect(roleResourceImportAction("model")).toEqual({ type: "none" });
    expect(roleResourceImportAction("persona")).toEqual({ type: "none" });
  });
});
