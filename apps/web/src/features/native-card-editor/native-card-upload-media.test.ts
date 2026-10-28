import { describe, expect, it } from "vitest";
import { nativeCardFileRules } from "@tavern/shared";
import { isNativeCardMediaReplacementCompatible, resolveNativeCardUploadMediaType } from "./native-card-upload-media.js";

describe("resolveNativeCardUploadMediaType", () => {
  it.each([undefined, "", "application/octet-stream"])("resolves SVG MIME from the shared extension table when browser type is %s", (browserType) => {
    expect(resolveNativeCardUploadMediaType("browser-upload.SVG", browserType)).toEqual({
      status: "resolved",
      mediaType: "image/svg+xml",
    });
  });

  it.each([undefined, "", "application/octet-stream"])("resolves PNG MIME from the shared extension table when browser type is %s", (browserType) => {
    expect(resolveNativeCardUploadMediaType("portrait.png", browserType)).toEqual({
      status: "resolved",
      mediaType: "image/png",
    });
  });

  it("keeps a browser MIME only when the shared format table supports it", () => {
    expect(resolveNativeCardUploadMediaType("portrait.png", "image/apng")).toEqual({
      status: "resolved",
      mediaType: "image/png",
    });
    expect(resolveNativeCardUploadMediaType("portrait.png", "text/plain")).toMatchObject({
      status: "unsupported-media-type",
      extension: ".png",
      mediaType: "text/plain",
    });
  });

  it("returns an actionable supported-extension list for unknown formats", () => {
    const result = resolveNativeCardUploadMediaType("portrait.unknown", "application/octet-stream");
    expect(result.status).toBe("unsupported-extension");
    if (result.status !== "unsupported-extension") throw new Error("Expected an unsupported extension result.");
    expect(result.extensions).toContain(".svg");
    expect(result.extensions).toContain(".png");
  });

  it("keeps configured extension mappings unique and within their supported MIME types", () => {
    const seen = new Set<string>();
    for (const format of nativeCardFileRules.assetMediaFormats) {
      for (const mapping of format.extensions) {
        expect(format.mediaTypes).toContain(mapping.mediaType);
        expect(seen.has(mapping.extension)).toBe(false);
        seen.add(mapping.extension);
      }
    }
  });

  it("requires replacement files to keep the package path's configured media format", () => {
    expect(isNativeCardMediaReplacementCompatible("assets/portrait.svg", "replacement.png")).toBe(false);
    expect(isNativeCardMediaReplacementCompatible("assets/portrait.svg", "replacement.svg")).toBe(true);
    expect(isNativeCardMediaReplacementCompatible("assets/portrait.jpg", "replacement.jpeg")).toBe(true);
  });
});
