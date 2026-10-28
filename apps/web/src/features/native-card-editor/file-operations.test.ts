import { describe, expect, it } from "vitest";
import { findPackageFileReferences, isFixedPackageFile, isPackageFileReadable } from "./file-operations.js";

describe("native card package file operations", () => {
  it("ignores the manifest file list and the target file when checking business references", () => {
    const paths = ["manifest.json", "character.json", "data/acceptance.json"];
    const contents = {
      "manifest.json": { encoding: "utf8", content: '{"files":["data/acceptance.json"]}' },
      "character.json": { encoding: "utf8", content: '{"metadata":{"notes":"data/acceptance.json"}}' },
      "data/acceptance.json": { encoding: "utf8", content: '{"path":"data/acceptance.json"}' },
    };

    expect(findPackageFileReferences(paths, "data/acceptance.json", contents)).toEqual(["character.json"]);
  });

  it("ignores malformed and non-UTF-8 JSON while keeping exact references", () => {
    const paths = ["data/broken.json", "data/binary.json", "worldbooks/book.json"];
    const contents = {
      "data/broken.json": { encoding: "utf8", content: "{" },
      "data/binary.json": { encoding: "base64", content: "e30=" },
      "worldbooks/book.json": { encoding: "utf8", content: '{"entryFiles":["data/target.json"]}' },
    };

    expect(findPackageFileReferences(paths, "data/target.json", contents)).toEqual(["worldbooks/book.json"]);
  });

  it("recognizes only paths declared as fixed in the shared package rules", () => {
    const fixedFiles = [{ pathPattern: "manifest.json" }, { pathPattern: "character.json" }];

    expect(isFixedPackageFile("character.json", fixedFiles)).toBe(true);
    expect(isFixedPackageFile("data/acceptance.json", fixedFiles)).toBe(false);
  });

  it("reads unsaved package files from the workspace and avoids server reads for missing, moved, or deleted paths", () => {
    const saved = ["character.json", "worldbooks/source/entries/1.json"];
    const local = ["worldbooks/target/entries/2.json"];
    const moveSources = ["worldbooks/source/entries/1.json"];
    const deleted = ["data/removed.json"];

    expect(isPackageFileReadable("worldbooks/target/entries/2.json", saved, local, moveSources, deleted)).toBe(true);
    expect(isPackageFileReadable("character.json", saved, local, moveSources, deleted)).toBe(true);
    expect(isPackageFileReadable("worldbooks/source/entries/1.json", saved, local, moveSources, deleted)).toBe(false);
    expect(isPackageFileReadable("data/removed.json", saved, local, moveSources, deleted)).toBe(false);
    expect(isPackageFileReadable("worldbooks/missing/entry.json", saved, local, moveSources, deleted)).toBe(false);
  });
});
