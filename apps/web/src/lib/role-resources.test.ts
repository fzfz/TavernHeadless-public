import { describe, it, expect, vi } from "vitest";
import { createTavernClient } from "@tavern/sdk";
import {
  createRoleResource,
  newRoleDocument,
  readRoleResource,
  saveRoleResource,
  serializeWorldbookEntries,
  updatePresetOrder,
  importRoleResource,
  previewRoleResourceImport,
} from "./role-resources.js";
import { parseResourceField } from "./role-resource-field.js";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("prototype resource editor preserves formal data", () => {
  it("creates distinct preset entry identifiers over HTTP without crypto.randomUUID", () => {
    const getRandomValues = vi
      .fn()
      .mockImplementationOnce((bytes: Uint8Array) => bytes.fill(0))
      .mockImplementationOnce((bytes: Uint8Array) => bytes.fill(0xff));
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      expect(newRoleDocument("preset").entries?.[0]?.identifier).toBe(
        "00000000-0000-4000-8000-000000000000",
      );
      expect(newRoleDocument("preset").entries?.[0]?.identifier).toBe(
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves worldbook entry arrays and extension fields", async () => {
    const data = {
      entries: [
        {
          uid: 41,
          key: ["灯塔"],
          content: "内容",
          extensions: { custom: true },
        },
      ],
      recursive: true,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "book", name: "世界书", version: 2, data },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: "book", name: "世界书", version: 3 } }),
      );
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });
    const document = await readRoleResource(client, "worldbook", "book");
    await saveRoleResource(client, "worldbook", document);
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string).data).toEqual(
      data,
    );
  });
  it("keeps preset top-level fields and ordering contexts", async () => {
    const editor = {
      format: "st-raw",
      default_character_id: 4,
      top_level: { custom: "keep" },
      entries: [
        {
          identifier: "x",
          name: "条目",
          content: "正文",
          role: "system",
          enabled: true,
          system_prompt: false,
          marker: false,
          injection_position: 1,
          injection_depth: 4,
          extra: { custom: "keep" },
        },
      ],
      order_contexts: [
        {
          character_id: 4,
          order: [{ identifier: "x", enabled: true }],
          extra: { custom: true },
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: "preset", name: "预设", version: 2, editor },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: "preset", name: "预设", version: 3 } }),
      );
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });
    const document = await readRoleResource(client, "preset", "preset");
    await saveRoleResource(client, "preset", document);
    const body = JSON.parse(fetch.mock.calls[1]![1].body as string);
    expect(body.editor.top_level).toEqual(editor.top_level);
    expect(body.editor.order_contexts).toEqual(editor.order_contexts);
    expect(body.editor.entries[0]).toMatchObject(editor.entries[0]!);
  });
  it("keeps an existing model credential when its password field is blank", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: "model",
          preset_name: "模型",
          model_id: "test",
          provider: "openai",
          status: "active",
        },
      }),
    );
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });
    await saveRoleResource(client, "model", {
      id: "model",
      name: "模型",
      value: {
        model_id: "test",
        provider: "openai",
        status: "active",
        api_key: "",
      },
    });
    expect(
      JSON.parse(fetch.mock.calls[0]![1].body as string),
    ).not.toHaveProperty("api_key");
  });
  it("propagates revision conflicts without retrying or replacing the resource", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "REVISION_CONFLICT", message: "conflict" } },
          409,
        ),
      );
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });
    await expect(
      saveRoleResource(client, "persona", {
        id: "persona",
        name: "人设",
        revision: 1,
        value: { description: "完整人设", status: "active" },
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("resource field input", () => {
  it("keeps arrays as arrays when editing keyword lists", () =>
    expect(parseResourceField("text", "风, 雨", false, ["灯塔"])).toEqual([
      "风",
      "雨",
    ]));
  it("parses checkbox, number, placement and tri-state controls", () => {
    expect(parseResourceField("check", "", true, false)).toBe(true);
    expect(parseResourceField("number", "0", false, 4)).toBe(0);
    expect(parseResourceField("nullableNumber", "", false, 4)).toBeNull();
    expect(parseResourceField("placements", "1,2", false, [])).toEqual([1, 2]);
    expect(parseResourceField("tri", "", false, true)).toBeNull();
    expect(parseResourceField("tri", "false", false, true)).toBe(false);
  });
  it("rejects invalid JSON and preserves valid nested documents", () => {
    expect(() => parseResourceField("json", "{", false, {})).toThrow();
    expect(parseResourceField("json", '{"value":[1]}', false, {})).toEqual({
      value: [1],
    });
  });
});

describe("resource changes remain effective after save", () => {
  it("retains dictionary keys while synchronizing worldbook runtime fields", () => {
    const original = {
      key: ["旧词"],
      keys: ["旧词"],
      disable: false,
      enabled: true,
      order: 5,
      insertion_order: 5,
      scanDepth: 2,
      extensions: { scan_depth: 2, custom: "保留" },
    };
    const result = serializeWorldbookEntries({
      id: "book",
      name: "book",
      value: { entries: { "42": original } },
      entryKeys: ["42"],
      entries: [
        { ...original, key: ["新词"], disable: true, order: 9, scanDepth: 4 },
      ],
    });
    expect(result).toEqual({
      "42": {
        ...original,
        key: ["新词"],
        keys: ["新词"],
        disable: true,
        enabled: false,
        order: 9,
        insertion_order: 9,
        scanDepth: 4,
        extensions: { scan_depth: 4, custom: "保留" },
      },
    });
  });
  it("moves worldbook dictionary entries without changing their identities", () => {
    const a = { uid: 4, content: "A" },
      b = { uid: 8, content: "B" };
    const result = serializeWorldbookEntries({
      id: "b",
      name: "b",
      value: { entries: { first: a, second: b } },
      entryKeys: ["second", "first"],
      entries: [b, a],
    });
    expect(Object.keys(result)).toEqual(["second", "first"]);
    expect(result).toEqual({ first: a, second: b });
  });
  it("updates the selected preset track and preserves other tracks", () => {
    const other = {
      characterId: 2,
      order: [{ identifier: "a", enabled: false }],
      extra: { private: true },
    };
    const document = {
      id: "p",
      name: "p",
      value: {
        defaultCharacterId: 1,
        orderContexts: [
          {
            characterId: 1,
            order: [{ identifier: "a", enabled: true }],
            extra: { keep: true },
          },
          other,
        ],
      },
      entries: [
        { identifier: "new", enabled: false },
        { identifier: "a", enabled: true },
      ],
    };
    updatePresetOrder(document);
    expect(document.value.orderContexts[0]).toEqual({
      characterId: 1,
      order: [
        { identifier: "new", enabled: false },
        { identifier: "a", enabled: true },
      ],
      extra: { keep: true },
    });
    expect(document.value.orderContexts[1]).toEqual(other);
  });
});

describe("role resource kinds exclude legacy character card editing", () => {
  it("rejects legacy card JSON even when it resembles a model profile", () => {
    expect(() =>
      previewRoleResourceImport("character" as never, "旧角色", {
        spec: "chara_card_v2",
        data: { name: "旧角色", provider: "openai", model_id: "legacy" },
        provider: "openai",
        model_id: "legacy",
      }),
    ).toThrow();
  });

  it("does not create a model profile for an unsupported legacy resource kind", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: "model" } }));
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });

    await expect(
      createRoleResource(client, "character" as never, {
        id: "",
        name: "旧角色",
        value: { provider: "openai", model_id: "legacy" },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects legacy card imports before issuing an API request", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { character_id: "character", name: "旧角色", character: {} },
      }),
    );
    const client = createTavernClient({
      baseUrl: "http://local.test",
      fetchImpl: fetch,
    });

    await expect(
      importRoleResource(client, "character" as never, "旧角色", {
        spec: "chara_card_v2",
        data: { name: "旧角色", provider: "openai", model_id: "legacy" },
        provider: "openai",
        model_id: "legacy",
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
