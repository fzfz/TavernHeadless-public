import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createRoleReleaseBodySchema } from "@tavern/shared";
import RoleAppsView from "./RoleAppsView.vue";
import labels from "../config/role-apps.json";
import { mountComponent, settleComponent } from "../test/component-host.js";
const bridge = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
vi.mock("../lib/api.js", () => ({
  get apiClient() {
    return bridge.api;
  },
}));
vi.mock("../App.vue", () => ({ default: { render: () => null } }));
vi.mock("../components/workspace/RoleGenerationDetail.vue", () => ({
  default: { render: () => null },
}));
vi.mock("../components/workspace/RoleSessionPanel.vue", () => ({
  default: { render: () => null },
}));
vi.mock("../composables/useRoleLabels.js", () => ({
  useRoleLabels: () => ({ labels, locale: ref("zh-CN") }),
}));
afterEach(() => vi.unstubAllGlobals());
it("keeps the newest resource versions when earlier selection resolves last", async () => {
  let resolveFirst!: (rows: { id: string; versionNo: number }[]) => void;
  const first = new Promise<{ id: string; versionNo: number }[]>((resolve) => {
    resolveFirst = resolve;
  });
  const empty = async () => [];
  bridge.api = {
    roleApps: { list: empty },
    characters: { list: empty },
    nativeCards: { list: empty },
    presets: {
      list: async () => [
        { id: "a", name: "Preset A" },
        { id: "b", name: "Preset B" },
      ],
      listVersions: ({ presetId }: { presetId: string }) =>
        presetId === "a"
          ? first
          : Promise.resolve([{ id: "b-v2", versionNo: 2 }]),
    },
    regexProfiles: { list: empty },
    worldbooks: { list: empty },
    users: { list: empty },
    llmProfiles: { list: empty },
    accounts: { list: empty },
    sessions: { list: async () => ({ items: [], nextCursor: null }) },
  };
  let beforeUnloadListener: ((event: BeforeUnloadEvent) => void) | undefined;
  const assign = vi.fn();
  vi.stubGlobal("window", {
    location: { search: "", href: "http://local.test/", assign },
    innerWidth: 1440,
    addEventListener(
      type: string,
      listener: (event: BeforeUnloadEvent) => void,
    ) {
      if (type === "beforeunload") beforeUnloadListener = listener;
    },
    removeEventListener() {},
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ userWebBaseUrl: "http://local.test:43982" }),
      ),
  );
  const host = mountComponent(RoleAppsView, {});
  try {
    await vi.waitFor(() => expect(host.root.textContent).toContain("Preset A"));
    const emptyCharacterSelection = host.all(
      (n) =>
        n.tagName === "SELECT" &&
        n.props["aria-label"] === labels.bindingUsage + labels.character,
    )[0]!;
    expect(emptyCharacterSelection.value).toBe("");
    expect(
      host.all(
        (n) =>
          n.tagName === "BUTTON" &&
          n.textContent === labels.edit + labels.character,
      )[0]?.props,
    ).toHaveProperty("disabled");
    const libraryCharacterButton = host.all(
      (node) =>
        node.tagName === "BUTTON" &&
        node.textContent === `${labels.character} 0`,
    )[0]!;
    libraryCharacterButton.click();
    expect(assign).toHaveBeenCalledWith("/character-editor");
    const untouchedUnload = { preventDefault: vi.fn(), returnValue: "" };
    beforeUnloadListener?.(untouchedUnload as unknown as BeforeUnloadEvent);
    expect(untouchedUnload.preventDefault).not.toHaveBeenCalled();
    const selection = host.all(
      (n) =>
        n.tagName === "SELECT" &&
        n.props["aria-label"] === labels.bindingUsage + labels.preset,
    )[0]!;
    selection.options.forEach((o) => {
      o.selected = o.value === "a";
    });
    selection.value = "a";
    selection.dispatchEvent(new Event("change"));
    await settleComponent();
    selection.options.forEach((o) => {
      o.selected = o.value === "b";
    });
    selection.value = "b";
    selection.dispatchEvent(new Event("change"));
    await settleComponent();
    const versions = () =>
      host.all(
        (n) =>
          n.tagName === "SELECT" &&
          n.props["aria-label"] === labels.preset + labels.version,
      )[0]!;
    await vi.waitFor(() => expect(versions().textContent).toContain("v2"));
    resolveFirst([{ id: "a-v1", versionNo: 1 }]);
    await settleComponent();
    expect(
      versions()
        .children.filter((n) => n.tagName === "OPTION")
        .map((n) => n.value),
    ).toContain("b-v2");
    expect(
      versions()
        .children.filter((n) => n.tagName === "OPTION")
        .map((n) => n.value),
    ).not.toContain("a-v1");
  } finally {
    host.unmount();
  }
});

it("keeps historical character bindings visible while routing package characters to the editor", async () => {
  const historicalConfiguration = createRoleReleaseBodySchema.parse({
    name: "Historical configuration",
    character_id: "historical-character",
    character_version_id: "historical-version",
    preset_id: "preset-1",
    preset_version_id: "preset-version-1",
    regex_profile_id: null,
    regex_profile_version_id: null,
    worldbook_id: null,
    worldbook_version_id: null,
    prompt_mode: "native",
    default_user_id: "user-1",
    model_slots: [
      {
        slot: "narrator",
        profile_id: "model-1",
        params: { temperature: 0.8, max_output_tokens: 1024 },
      },
    ],
  });
  const empty = async () => [];
  const assign = vi.fn();
  const validate = vi.fn(
    async (_input: { configuration: Record<string, unknown> }) => ({
      valid: true as const,
      versionId: "version-1",
      files: [],
      stateUpdate: null,
    }),
  );
  bridge.api = {
    roleApps: {
      list: async () => [
        {
          id: "app-1",
          revision: 1,
          updated_at: 1,
          configuration: historicalConfiguration,
        },
      ],
      listPreviews: empty,
      validate,
    },
    characters: {
      list: async () => [
        {
          id: "package-character",
          name: "Package character",
          status: "active",
        },
        {
          id: "historical-character",
          name: "Historical character",
          status: "active",
        },
        {
          id: "unassociated-character",
          name: "Unassociated character",
          status: "active",
        },
      ],
      listVersions: async () => [{ id: "historical-version", versionNo: 1 }],
    },
    nativeCards: {
      list: async () => [
        { id: "package-workspace-id", characterId: "package-character" },
      ],
    },
    presets: {
      list: async () => [{ id: "preset-1", name: "Preset" }],
      listVersions: async () => [{ id: "preset-version-1", versionNo: 1 }],
    },
    regexProfiles: {
      list: async () => [{ id: "regex-1", name: "Regex" }],
      listVersions: async () => [{ id: "regex-version-1", versionNo: 1 }],
    },
    worldbooks: { list: empty, listVersions: empty },
    users: { list: empty },
    llmProfiles: { list: empty },
    accounts: { list: empty },
    roleReleases: { list: empty },
    sessions: { list: empty },
  };
  let beforeUnloadListener: ((event: BeforeUnloadEvent) => void) | undefined;
  vi.stubGlobal("window", {
    location: {
      search: "",
      href: "http://local.test/",
      assign,
    },
    history: { replaceState() {} },
    innerWidth: 1440,
    addEventListener(
      type: string,
      listener: (event: BeforeUnloadEvent) => void,
    ) {
      if (type === "beforeunload") beforeUnloadListener = listener;
    },
    removeEventListener() {},
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ userWebBaseUrl: "http://local.test:43982" }),
      ),
  );
  const host = mountComponent(RoleAppsView, {});
  try {
    const characterSelect = () =>
      host.all(
        (node) =>
          node.tagName === "SELECT" &&
          node.props["aria-label"] === labels.bindingUsage + labels.character,
      )[0]!;
    await vi.waitFor(() =>
      expect(characterSelect().options.map((option) => option.value)).toContain(
        "package-character",
      ),
    );

    const choices = characterSelect().options;
    expect(
      choices.find((option) => option.value === "package-character")?.props
        .disabled,
    ).toBeUndefined();
    expect(
      choices.find((option) => option.value === "historical-character")?.props,
    ).toHaveProperty("disabled");
    expect(
      choices.some((option) => option.value === "unassociated-character"),
    ).toBe(false);
    expect(host.root.textContent).toContain(labels.characterPackageMissing);
    expect(host.root.textContent).toContain(labels.clean);

    const editCharacter = host.all(
      (node) =>
        node.tagName === "BUTTON" &&
        node.textContent === labels.edit + labels.character,
    )[0]!;
    expect(editCharacter.props).toHaveProperty("disabled");

    const manageCharacter = host.all(
      (node) =>
        node.tagName === "BUTTON" &&
        node.textContent === labels.manage + labels.character,
    )[0]!;
    manageCharacter.click();
    expect(assign).toHaveBeenCalledWith("/character-editor");

    const resourceButton = host.all(
      (node) =>
        node.tagName === "BUTTON" &&
        node.textContent === `${labels.character} 1`,
    )[0]!;
    resourceButton.click();
    expect(assign).toHaveBeenLastCalledWith("/character-editor");

    const regexSelect = host.all(
      (node) =>
        node.tagName === "SELECT" &&
        node.props["aria-label"] === labels.bindingUsage + labels.regex,
    )[0]!;
    regexSelect.options.forEach((option) => {
      option.selected = option.value === "regex-1";
    });
    regexSelect.value = "regex-1";
    regexSelect.dispatchEvent(new Event("change"));
    await settleComponent();
    const regexVersionSelect = () =>
      host.all(
        (node) =>
          node.tagName === "SELECT" &&
          node.props["aria-label"] === labels.regex + labels.version,
      )[0]!;
    await vi.waitFor(() =>
      expect(
        regexVersionSelect().options.map((option) => option.value),
      ).toContain("regex-version-1"),
    );
    regexVersionSelect().options.forEach((option) => {
      option.selected = option.value === "regex-version-1";
    });
    regexVersionSelect().value = "regex-version-1";
    regexVersionSelect().dispatchEvent(new Event("change"));
    await settleComponent();
    regexSelect.options.forEach((option) => {
      option.selected = option.value === null;
    });
    regexSelect.value = null;
    regexSelect.dispatchEvent(new Event("change"));
    await settleComponent();
    const checkButton = host.all(
      (node) => node.tagName === "BUTTON" && node.textContent === labels.check,
    )[0]!;
    checkButton.click();
    await vi.waitFor(() => expect(validate).toHaveBeenCalledOnce());
    expect(validate.mock.calls[0]?.[0]).toMatchObject({
      configuration: {
        regex_profile_id: null,
        regex_profile_version_id: null,
      },
    });

    const characterSelectAfterRegex = characterSelect();
    characterSelectAfterRegex.options.forEach((option) => {
      option.selected = option.value === "package-character";
    });
    characterSelectAfterRegex.value = "package-character";
    characterSelectAfterRegex.dispatchEvent(new Event("change"));
    await settleComponent();
    const editPackageCharacter = host.all(
      (node) =>
        node.tagName === "BUTTON" &&
        node.textContent === labels.edit + labels.character,
    )[0]!;
    expect(editPackageCharacter.props.disabled).toBe(false);
    editPackageCharacter.click();
    await settleComponent();
    expect(assign).toHaveBeenCalledTimes(2);
    expect(host.root.textContent).toContain(labels.allChanges);
    host
      .all(
        (node) =>
          node.tagName === "BUTTON" && node.textContent === labels.discard,
      )[0]!
      .click();
    expect(assign).toHaveBeenLastCalledWith(
      "/character-editor?id=package-workspace-id",
    );
    const confirmedUnload = { preventDefault: vi.fn(), returnValue: "" };
    beforeUnloadListener?.(confirmedUnload as unknown as BeforeUnloadEvent);
    expect(confirmedUnload.preventDefault).not.toHaveBeenCalled();
  } finally {
    host.unmount();
  }
});
