import { describe, expect, it } from "vitest";
import {
  nativeCardEditorHref,
  packageBackedCharacters,
} from "./card-editor-navigation.js";

describe("native card editor navigation", () => {
  const cards = [{ id: "workspace-card/one", characterId: "character-one" }];

  it("shows role resources only when an editable package refers to them", () => {
    const characters = [
      { id: "character-one", name: "Package character", status: "active" },
      {
        id: "historical-character",
        name: "Historical character",
        status: "active",
      },
    ];

    expect(packageBackedCharacters(characters, cards)).toEqual([characters[0]]);
  });

  it("excludes deleted characters even when a package is still associated", () => {
    expect(
      packageBackedCharacters(
        [{ id: "character-one", status: "deleted" }],
        cards,
      ),
    ).toEqual([]);
  });

  it("opens the editor catalog when a character directory is requested", () => {
    expect(nativeCardEditorHref("/character-editor", cards)).toBe(
      "/character-editor",
    );
  });

  it("maps characterId to the package workspace id for edit navigation", () => {
    expect(
      nativeCardEditorHref("/character-editor", cards, "character-one"),
    ).toBe("/character-editor?id=workspace-card%2Fone");
  });

  it("does not create an editor destination for a character without a package", () => {
    expect(
      nativeCardEditorHref("/character-editor", cards, "historical-character"),
    ).toBeUndefined();
  });
});
