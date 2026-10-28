import { describe, expect, it } from "vitest";

import type { WorkspacePresetEditorDocument } from "../../lib/workspace-api";
import { serializePresetEditorDocument, toApiPresetEditorDocument } from "./preset-editor";

describe("preset editor serialization", () => {
  it("preserves existing track membership and adds a fresh prompt only to the default track", () => {
    const editor = {
      defaultCharacterId: 1,
      entries: [
        { identifier: "main", name: "Main", role: "system", content: "main", systemPrompt: false, marker: false, injectionPosition: 0, enabled: false, extra: {}, isOriginal: true },
        { identifier: "character_only", name: "Character", role: "system", content: "character", systemPrompt: false, marker: false, injectionPosition: 0, enabled: true, extra: {}, isOriginal: true },
        { identifier: "new_prompt", name: "New", role: "system", content: "new", systemPrompt: false, marker: false, injectionPosition: 0, enabled: true, extra: {}, isOriginal: false },
      ],
      format: "st-raw",
      orderContexts: [
        { characterId: 1, order: [{ identifier: "main", enabled: false }], extra: { trackExtension: "default" } },
        { characterId: 2, order: [{ identifier: "character_only", enabled: false }], extra: { trackExtension: "character" } },
      ],
      topLevel: {},
    } as unknown as WorkspacePresetEditorDocument;

    const serialized = serializePresetEditorDocument(editor);
    expect(serialized.prompt_order).toEqual([
      {
        character_id: 1,
        order: [
          { identifier: "main", enabled: false },
          { identifier: "new_prompt", enabled: true },
        ],
        trackExtension: "default",
      },
      {
        character_id: 2,
        order: [{ identifier: "character_only", enabled: false }],
        trackExtension: "character",
      },
    ]);

    expect(toApiPresetEditorDocument(editor).order_contexts).toEqual([
      {
        character_id: 1,
        order: [
          { identifier: "main", enabled: false },
          { identifier: "new_prompt", enabled: true },
        ],
        trackExtension: "default",
      },
      {
        character_id: 2,
        order: [{ identifier: "character_only", enabled: false }],
        trackExtension: "character",
      },
    ]);
  });

  it("exports the editor's explicit default track identifier", () => {
    const editor = {
      defaultCharacterId: 23,
      entries: [
        { identifier: "existing", name: "Existing", role: "system", content: "existing", systemPrompt: true, marker: false, injectionPosition: 0, enabled: true, extra: {}, isOriginal: true },
        { identifier: "added", name: "Added", role: "system", content: "added", systemPrompt: false, marker: false, injectionPosition: 0, enabled: true, extra: {}, isOriginal: false },
      ],
      format: "st-raw",
      orderContexts: [
        { characterId: 17, order: [{ identifier: "existing", enabled: false }], extra: {} },
        { characterId: 23, order: [], extra: {} },
      ],
      topLevel: {},
    } as unknown as WorkspacePresetEditorDocument;

    const serialized = serializePresetEditorDocument(editor);
    expect(serialized.default_character_id).toBe(23);
    expect(serialized.prompt_order).toEqual([
      {
        character_id: 17,
        order: [{ identifier: "existing", enabled: false }],
      },
      {
        character_id: 23,
        order: [{ identifier: "added", enabled: true }],
      },
    ]);
  });
});
