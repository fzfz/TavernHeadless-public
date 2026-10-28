import { describe, expect, it } from "vitest";
import { orderDomainFiles, orderPackageFilesByTemplates } from "./domain-file-order.js";

describe("domain file order", () => {
  it("uses shared creation-template order and sorts additional files last", () => {
    expect(orderPackageFilesByTemplates(
      ["frontend/style.css", "frontend/main.js", "frontend/index.html", "frontend/manifest.json", "frontend/z-extra.json"],
      [
        { pathTemplate: "frontend/manifest.json" },
        { pathTemplate: "frontend/index.html" },
        { pathTemplate: "frontend/style.css" },
        { pathTemplate: "frontend/main.js" },
      ],
    )).toEqual([
      "frontend/manifest.json",
      "frontend/index.html",
      "frontend/style.css",
      "frontend/main.js",
      "frontend/z-extra.json",
    ]);
  });

  it("orders files matching dynamic templates and preserves remaining paths", () => {
    expect(orderPackageFilesByTemplates(
      ["openings/b.txt", "openings/a.txt", "unusual.txt"],
      [{ pathTemplate: "openings/{openingId}.txt" }],
    )).toEqual(["openings/a.txt", "openings/b.txt", "unusual.txt"]);
  });

  it("shows only opening texts and the variable schema with initial states", () => {
    const paths = ["openings.json", "openings/second.txt", "openings/first.txt", "state/schema.json", "state/initial/first.json", "state-update.json"];

    expect(orderDomainFiles("openings", paths, [])).toEqual(["openings/first.txt", "openings/second.txt"]);
    expect(orderDomainFiles("variables", paths, [])).toEqual(["state/initial/first.json", "state/schema.json"]);
  });

  it("orders worldbook indices and entries together by package path", () => {
    expect(orderDomainFiles("worldbooks", [
      "worldbooks/z/book.json",
      "worldbooks/a/entries/custom.json",
      "worldbooks/a/book.json",
    ], [])).toEqual([
      "worldbooks/a/book.json",
      "worldbooks/a/entries/custom.json",
      "worldbooks/z/book.json",
    ]);
  });
});
