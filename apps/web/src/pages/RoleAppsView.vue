<script setup lang="ts">
import { vModalFocus } from "../directives/modal-focus.js";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createRoleReleaseBodySchema,
  roleAdminWebConfigSchema,
  apiErrorMessages,
  publicConfigurationFiles,
  roleStatePolicy,
  type CreateRoleReleaseBody,
  type RoleApp,
  type ModelCallDetail,
  type NativeCard,
  rolePreviewSessionMetadataSchema,
} from "@tavern/shared";
import type {
  CharacterListItem,
  PresetListItem,
  RegexProfileListItem,
  WorldbookListItem,
  UserRecord,
  LlmProfile,
  TimelineFloor,
  SessionDetail,
  SessionRecord,
} from "@tavern/sdk";
import { apiClient } from "../lib/api.js";
import { nativeCardEditorConfig } from "../features/native-card-editor/config.js";
import {
  nativeCardEditorHref,
  packageBackedCharacters,
} from "../lib/card-editor-navigation.js";
import type { RoleResourceKind } from "../lib/role-resource.schema.js";
import { roleConfigurationIssues } from "../lib/role-configuration-validation.js";
import { listFormalRoleSessions } from "../lib/role-workspace-sessions.js";
import { loadGenerationDetailLocation } from "../lib/generation-detail-location.js";
const formalSessions = ref<SessionRecord[]>([]);
const initialDetailCall = ref<ModelCallDetail>();
const initialDetailRun = ref<string>();

import { useRoleLabels } from "../composables/useRoleLabels.js";
const { labels, locale } = useRoleLabels();
import defaults from "../config/role-app-defaults.json";
import ManagersHost from "../App.vue";
import { useWorkspacePaneLayout } from "../composables/workspace/shell/pane-layout.js";
import RoleResourceLibrary from "../components/workspace/RoleResourceLibrary.vue";
import RoleSessionPanel from "../components/workspace/RoleSessionPanel.vue";
import { roleConfigurationIsPublished } from "../lib/role-publication.js";
import { useRoleNavigation } from "../composables/useRoleNavigation.js";
import RoleGenerationParams from "../components/workspace/RoleGenerationParams.vue";
import RoleGenerationDetail from "../components/workspace/RoleGenerationDetail.vue";
import MarkdownBlock from "../components/workspace/MarkdownBlock.vue";
import { roleSessionTimelineMessages } from "../lib/role-session-timeline.js";
const managers = ref<InstanceType<typeof ManagersHost>>();
const resourceEditor = ref<InstanceType<typeof RoleResourceLibrary>>();
const sessionPanel = ref<InstanceType<typeof RoleSessionPanel>>();
const libraryEditing = ref(false);
const {
  pendingNavigation,
  discardsConfiguration,
  navigate,
  cancelNavigation,
  discardAndNavigate,
} = useRoleNavigation({
  resourceDirty: () =>
    !!resourceEditor.value?.dirty || !!sessionPanel.value?.dirty,
  configurationDirty: () => configurationChanged.value,
});
function goView(next: string) {
  navigate(() => {
    view.value = next;
  });
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (allowConfirmedNavigationUnload) {
    allowConfirmedNavigationUnload = false;
    return;
  }
  if (
    resourceEditor.value?.dirty ||
    sessionPanel.value?.dirty ||
    configurationChanged.value
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
}

const {
  paneLayoutStyles,
  beginPaneResize,
  resizePaneByKeyboard,
  stopPaneResize,
  clampPaneWidths,
} = useWorkspacePaneLayout(labels.layout);
const invalidRuntimeSlots = ref(new Set<string>());
const runtimeDrafts = ref<Record<string, Record<string, string>>>({});
function runtimeValidity(slot: string, valid: boolean) {
  if (valid) invalidRuntimeSlots.value.delete(slot);
  else invalidRuntimeSlots.value.add(slot);
}
const navOpen = ref(false),
  inspectorOpen = ref(false);
const tab = ref("configuration");
const view = ref("records");
const libraryKind = ref<RoleResourceKind>("preset");
const resourceId = ref<string>();
let allowConfirmedNavigationUnload = false;
const sessionFilter = ref("active");
const selectedSessionId = ref("");
const sessionDetail = ref<SessionDetail>();
const floors = ref<TimelineFloor[]>([]);
const timelineBranch = ref("main");
const timelineBusy = ref(false),
  hasMore = ref(false);
const activeFloor = ref<TimelineFloor>();
const renameOpen = ref(false),
  renameValue = ref("");
const deleteTarget = ref("");
const events = ref<string[]>([]);
const releases = ref<Awaited<ReturnType<typeof apiClient.roleReleases.list>>>(
  [],
);
const accounts = ref<Awaited<ReturnType<typeof apiClient.accounts.list>>>([]);
const activeReleases = ref<
  Awaited<ReturnType<typeof apiClient.roleReleases.list>>
>([]);
const apps = ref<RoleApp[]>([]),
  selected = ref<RoleApp>(),
  form = ref(structuredClone(defaults) as CreateRoleReleaseBody),
  busy = ref(false),
  failure = ref(""),
  notice = ref(""),
  userWebBaseUrl = ref("");
const characters = ref<CharacterListItem[]>([]),
  nativeCards = ref<NativeCard[]>([]),
  presets = ref<PresetListItem[]>([]),
  regexes = ref<RegexProfileListItem[]>([]),
  worldbooks = ref<WorldbookListItem[]>([]),
  users = ref<UserRecord[]>([]),
  models = ref<LlmProfile[]>([]);
const characterVersions = ref<Array<{ id: string; versionNo: number }>>([]),
  presetVersions = ref<Array<{ id: string; versionNo: number }>>([]),
  statePresetVersions = ref<Array<{ id: string; versionNo: number }>>([]),
  regexVersions = ref<Array<{ id: string; versionNo: number }>>([]),
  worldbookVersions = ref<Array<{ id: string; versionNo: number }>>([]);
const packageCharacters = computed(() =>
  packageBackedCharacters(characters.value, nativeCards.value),
);
const packageCharacterIds = computed(
  () => new Set(packageCharacters.value.map((character) => character.id)),
);
const boundCharacterHasPackage = computed(
  () =>
    !!form.value.character_id &&
    packageCharacterIds.value.has(form.value.character_id),
);
const boundCharacterName = computed(
  () =>
    characters.value.find(
      (character) => character.id === form.value.character_id,
    )?.name ?? form.value.character_id,
);
const previews = ref<
  Awaited<ReturnType<typeof apiClient.roleApps.listPreviews>>
>([]);
const dirty = computed(() => !selected.value || configurationChanged.value);
const configurationChanged = computed(
  () =>
    invalidRuntimeSlots.value.size > 0 ||
    JSON.stringify(form.value) !==
      JSON.stringify(selected.value?.configuration ?? defaults),
);
const configurationIssues = computed(() => roleConfigurationIssues(form.value));
const errorFields = computed(() =>
  failureDetails.value &&
  typeof failureDetails.value === "object" &&
  !Array.isArray(failureDetails.value)
    ? Object.entries(failureDetails.value).map(([key, value]) => ({
        key: (labels.validationFields as Record<string, string>)[key] ?? key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }))
    : [],
);
const bindingSummary =
  ref<Awaited<ReturnType<typeof apiClient.roleApps.validate>>>();
const checked = ref(false),
  checking = ref(false),
  failureDetails = ref<unknown>();
watch(
  form,
  () => {
    checked.value = false;
    bindingSummary.value = undefined;
    failureDetails.value = undefined;
  },
  { deep: true },
);
const resourceBindings = computed(() => {
  const collections = {
    character: characters.value,
    preset: presets.value,
    regex: regexes.value,
    worldbook: worldbooks.value,
  };
  return labels.resourceBindings.map((spec) => {
    const key = spec.key as keyof typeof collections;
    const id = form.value[spec.id as keyof CreateRoleReleaseBody];
    const item = collections[key].find((item) => item.id === id);
    return {
      kind: labels[key],
      name: item?.name ?? labels.unbound,
      id,
      version: form.value[spec.version as keyof CreateRoleReleaseBody],
      status: id ? labels.enabled : labels.unbound,
    };
  });
});
async function checkConfiguration() {
  if (configurationIssues.value.length) {
    checked.value = false;
    return;
  }
  checking.value = true;
  failure.value = "";
  failureDetails.value = undefined;
  try {
    const input = createRoleReleaseBodySchema.parse(form.value);
    const result = await apiClient.roleApps.validate({ configuration: input });
    if (JSON.stringify(input) === JSON.stringify(form.value)) {
      bindingSummary.value = result;
      checked.value = true;
    }
  } catch (error) {
    checked.value = false;
    report(error);
  } finally {
    checking.value = false;
  }
}
function report(error: unknown) {
  failureDetails.value =
    error && typeof error === "object" && "details" in error
      ? error.details
      : error && typeof error === "object" && "issues" in error
        ? error.issues
        : undefined;
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : error && typeof error === "object" && "issues" in error
        ? "validation_error"
        : undefined;
  failure.value =
    typeof code === "string" && code in apiErrorMessages
      ? String(apiErrorMessages[code as keyof typeof apiErrorMessages])
      : apiErrorMessages.ROLE_USER_REQUEST_FAILED;
}
async function load() {
  const incoming = new URLSearchParams(window.location.search);
  const detailLocation = incoming.has("floorId")
    ? Object.fromEntries(
        ["sessionId", "branchId", "floorId", "runId", "pageId", "callId"]
          .filter((key) => incoming.has(key))
          .map((key) => [key, incoming.get(key)!]),
      )
    : undefined;
  busy.value = true;
  failure.value = "";
  try {
    const configResponse = await fetch(`/config/${publicConfigurationFiles.roleAdminWeb.filename}`);
    if (!configResponse.ok)
      throw Object.assign(new Error(), { code: "ROLE_APP_CONFIG_INVALID" });
    const config = roleAdminWebConfigSchema.safeParse(
      await configResponse.json(),
    );
    if (!config.success)
      throw Object.assign(new Error(), { code: "ROLE_APP_CONFIG_INVALID" });
    userWebBaseUrl.value = config.data.userWebBaseUrl;
    [
      apps.value,
      characters.value,
      nativeCards.value,
      presets.value,
      regexes.value,
      worldbooks.value,
      users.value,
      models.value,
    ] = await Promise.all([
      apiClient.roleApps.list(),
      apiClient.characters.list(),
      apiClient.nativeCards.list(),
      apiClient.presets.list(),
      apiClient.regexProfiles.list(),
      apiClient.worldbooks.list(),
      apiClient.users.list(),
      apiClient.llmProfiles.list(),
    ]);
    [accounts.value, formalSessions.value] = await Promise.all([
      apiClient.accounts.list(),
      listFormalRoleSessions(apiClient, labels.pageSize),
    ]);
    const id = incoming.get("id");
    const incomingSessionId = incoming.get("sessionId");
    const incomingSession = incomingSessionId
      ? await apiClient.sessions.getDetail({ sessionId: incomingSessionId })
      : undefined;
    const previewMetadata = rolePreviewSessionMetadataSchema.safeParse(
      incomingSession?.metadata,
    );
    const existing = incomingSession
      ? apps.value.find((item) =>
          previewMetadata.success
            ? item.id === previewMetadata.data.role_preview.draft_id
            : item.configuration.character_id ===
              incomingSession.characterBinding?.characterId,
        )
      : id
        ? apps.value.find((item) => item.id === id)
        : apps.value[0];
    if (existing) await select(existing);
    if (detailLocation) {
      const { location, selectedCall } = await loadGenerationDetailLocation(
        apiClient,
        detailLocation,
      );
      await selectSession(location.sessionId, location.branchId);
      let floor = floors.value.find((item) => item.id === location.floorId);
      while (!floor && hasMore.value) {
        await moreFloors();
        floor = floors.value.find((item) => item.id === location.floorId);
        if (failure.value) break;
      }
      if (!floor)
        throw Object.assign(new Error(), {
          code: "GENERATION_DETAIL_LOCATION_INVALID",
        });
      openGeneration(floor);
      initialDetailCall.value = selectedCall;
      initialDetailRun.value = location.runId;
      const restoredUrl = new URL(window.location.href);
      for (const key of ["runId", "callId", "pageId"] as const) {
        if (location[key]) restoredUrl.searchParams.set(key, location[key]);
      }
      window.history.replaceState(null, "", restoredUrl);
    }
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
const versionRequests = {
  character: 0,
  preset: 0,
  statePreset: 0,
  regex: 0,
  worldbook: 0,
};
async function versions(kind: keyof typeof versionRequests, clear = true) {
  const request = ++versionRequests[kind];
  const configuration = form.value;
  const readId = () =>
    kind === "character"
      ? form.value.character_id
      : kind === "preset"
        ? form.value.preset_id
        : kind === "statePreset"
          ? (form.value.statePresetId ?? "")
          : kind === "regex"
            ? form.value.regex_profile_id
            : form.value.worldbook_id;
  const selectedId = readId();
  const current = () =>
    request === versionRequests[kind] &&
    configuration === form.value &&
    selectedId === readId();
  try {
    if (kind === "character") {
      if (clear) {
        form.value.character_version_id = "";
        characterVersions.value = [];
      }
      const rows = configuration.character_id
        ? await apiClient.characters.listVersions({
            characterId: configuration.character_id,
          })
        : [];
      if (current()) characterVersions.value = rows;
    }
    if (kind === "preset") {
      if (clear) {
        form.value.preset_version_id = "";
        presetVersions.value = [];
      }
      const rows = configuration.preset_id
        ? await apiClient.presets.listVersions({
            presetId: configuration.preset_id,
          })
        : [];
      if (current()) presetVersions.value = rows;
    }
    if (kind === "statePreset") {
      if (clear) {
        form.value.statePresetVersionId = undefined;
        statePresetVersions.value = [];
      }
      const rows = configuration.statePresetId
        ? await apiClient.presets.listVersions({
            presetId: configuration.statePresetId,
          })
        : [];
      if (current()) statePresetVersions.value = rows;
    }
    if (kind === "regex") {
      if (clear) {
        form.value.regex_profile_version_id = form.value.regex_profile_id
          ? ""
          : null;
        regexVersions.value = [];
      }
      const rows = configuration.regex_profile_id
        ? await apiClient.regexProfiles.listVersions({
            profileId: configuration.regex_profile_id,
          })
        : [];
      if (current()) regexVersions.value = rows;
    }
    if (kind === "worldbook") {
      if (clear) {
        form.value.worldbook_version_id = null;
        worldbookVersions.value = [];
      }
      const rows = configuration.worldbook_id
        ? await apiClient.worldbooks.listVersions({
            worldbookId: configuration.worldbook_id,
          })
        : [];
      if (current()) worldbookVersions.value = rows;
    }
  } catch (error) {
    if (current()) report(error);
  }
}
function setStatePreset(value: string) {
  form.value.statePresetId = value || undefined;
  void versions("statePreset");
}
function setStateHistoryTurns(value: string) {
  const trimmed = value.trim();
  form.value.stateHistoryTurns = trimmed ? Number(trimmed) : undefined;
}
const appLoading = ref(false);
let appRequest = 0;
async function select(item: RoleApp) {
  const request = ++appRequest;
  appLoading.value = true;
  try {
    ++sessionRequest;
    const configuration = createRoleReleaseBodySchema.parse(item.configuration);
    const characterHasPackage = packageCharacterIds.value.has(
      configuration.character_id,
    );
    const [
      characterList,
      presetList,
      regexList,
      worldbookList,
      statePresetList,
      trialList,
      releaseList,
      activeList,
    ] = await Promise.all([
      characterHasPackage
        ? apiClient.characters.listVersions({
            characterId: configuration.character_id,
          })
        : Promise.resolve([]),
      apiClient.presets.listVersions({ presetId: configuration.preset_id }),
      configuration.regex_profile_id
        ? apiClient.regexProfiles.listVersions({
            profileId: configuration.regex_profile_id,
          })
        : Promise.resolve([]),
      configuration.worldbook_id
        ? apiClient.worldbooks.listVersions({
            worldbookId: configuration.worldbook_id,
          })
        : Promise.resolve([]),
      configuration.statePresetId
        ? apiClient.presets.listVersions({
            presetId: configuration.statePresetId,
          })
        : Promise.resolve([]),
      apiClient.roleApps.listPreviews({ id: item.id }),
      apiClient.roleReleases.list(),
      apiClient.roleReleases.list({ activeOnly: true }),
    ]);
    if (request !== appRequest) return;
    selected.value = item;
    form.value = configuration;
    invalidRuntimeSlots.value.clear();
    runtimeDrafts.value = {};
    characterVersions.value = characterList;
    presetVersions.value = presetList;
    regexVersions.value = regexList;
    worldbookVersions.value = worldbookList;
    statePresetVersions.value = statePresetList;
    previews.value = trialList;
    releases.value = releaseList;
    activeReleases.value = activeList;
    notice.value = "";
    failure.value = "";
    const url = new URL(window.location.href);
    const current = url.searchParams.get("sessionId");
    selectedSessionId.value =
      trialList.find(
        (preview) => preview.id === (current ?? selectedSessionId.value),
      )?.id ??
      visibleFormalSessions.value.find((item) => item.id === current)?.id ??
      trialList[0]?.id ??
      "";
    url.searchParams.set("id", item.id);
    url.searchParams.delete("sessionId");
    window.history.replaceState(null, "", url);
    if (selectedSessionId.value) await selectSession(selectedSessionId.value);
    else {
      floors.value = [];
      sessionDetail.value = undefined;
      activeFloor.value = undefined;
      timelineBusy.value = false;
      view.value = "records";
      for (const key of ["floorId", "branchId", "runId", "pageId", "callId"])
        url.searchParams.delete(key);
      window.history.replaceState(null, "", url);
    }
  } finally {
    if (request === appRequest) appLoading.value = false;
  }
}
function fresh() {
  invalidRuntimeSlots.value.clear();
  runtimeDrafts.value = {};
  ++appRequest;
  ++sessionRequest;
  selected.value = undefined;
  form.value = structuredClone(defaults) as CreateRoleReleaseBody;
  previews.value = [];
  selectedSessionId.value = "";
  sessionDetail.value = undefined;
  floors.value = [];
  view.value = "configuration";
  tab.value = "configuration";
  characterVersions.value = [];
  presetVersions.value = [];
  regexVersions.value = [];
  worldbookVersions.value = [];
  statePresetVersions.value = [];
  notice.value = "";
  failure.value = "";
}
async function save() {
  if (busy.value || invalidRuntimeSlots.value.size) return;
  busy.value = true;
  failure.value = "";
  notice.value = "";
  try {
    const configuration = createRoleReleaseBodySchema.parse(form.value);
    const item = selected.value
      ? await apiClient.roleApps.update({
          id: selected.value.id,
          expectedRevision: selected.value.revision,
          configuration,
        })
      : await apiClient.roleApps.create({ configuration });
    apps.value = await apiClient.roleApps.list();
    await select(item);
    notice.value = labels.saved;
    events.value.unshift(labels.saved);
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function preview(sessionId?: string) {
  if (busy.value || !selected.value) return;
  busy.value = true;
  failure.value = "";
  try {
    const id =
      sessionId ??
      String(
        (
          await apiClient.roleApps.createPreview({
            id: selected.value.id,
            expectedRevision: selected.value.revision,
          })
        ).session.id,
      );
    const url = new URL(userWebBaseUrl.value);
    url.searchParams.set("sessionId", id);
    for (const key of ["floorId", "branchId", "runId", "pageId", "callId"])
      url.searchParams.delete(key);
    window.location.assign(url.href);
    previews.value = await apiClient.roleApps.listPreviews({
      id: selected.value.id,
    });
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function publish() {
  if (busy.value || !selected.value) return;
  busy.value = true;
  failure.value = "";
  try {
    await apiClient.roleApps.validate({
      configuration: createRoleReleaseBodySchema.parse(form.value),
    });
    checked.value = true;
    await apiClient.roleApps.publish({
      id: selected.value.id,
      expectedRevision: selected.value.revision,
    });
    [releases.value, activeReleases.value] = await Promise.all([
      apiClient.roleReleases.list(),
      apiClient.roleReleases.list({ activeOnly: true }),
    ]);
    notice.value = labels.published;
    events.value.unshift(labels.published);
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function remove(sessionId: string) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    await apiClient.sessions.remove({ sessionId });
    previews.value = previews.value.filter((item) => item.id !== sessionId);
    formalSessions.value = formalSessions.value.filter(
      (item) => item.id !== sessionId,
    );
    deleteTarget.value = "";
    if (selectedSessionId.value === sessionId) {
      selectedSessionId.value = "";
      sessionDetail.value = undefined;
      floors.value = [];
      if (previews.value[0]) await selectSession(previews.value[0].id);
    }
    events.value.unshift(labels.deleted);
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
const generationFloors = computed(() =>
  floors.value.filter((floor) => floor.floorNo > 0),
);
const visibleFormalSessions = computed(() =>
  formalSessions.value.filter(
    (item) =>
      item.characterBinding?.characterId ===
      selected.value?.configuration.character_id,
  ),
);
const isFormalSession = computed(() =>
  formalSessions.value.some((item) => item.id === selectedSessionId.value),
);
const currentPreview = computed(() => {
  const preview = previews.value.find(
    (item) => item.id === selectedSessionId.value,
  );
  if (preview) return preview;
  const formal = formalSessions.value.find(
    (item) => item.id === selectedSessionId.value,
  );
  return formal
    ? {
        id: formal.id,
        title: formal.title,
        status: formal.status,
        created_at: formal.createdAt,
        draft_revision: undefined,
      }
    : undefined;
});
const visiblePreviews = computed(() =>
  previews.value.filter((item) => item.status === sessionFilter.value),
);
const resources = computed(() => [
  { key: "character", label: labels.character, items: packageCharacters.value },
  { key: "preset", label: labels.preset, items: presets.value },
  { key: "worldbook", label: labels.worldbook, items: worldbooks.value },
  { key: "regex", label: labels.regex, items: regexes.value },
  { key: "model", label: labels.model, items: models.value },
  { key: "persona", label: labels.personaResource, items: users.value },
]);
const bindings = computed(() => [
  {
    key: "character" as const,
    label: labels.character,
    id: "character_id" as const,
    version: "character_version_id" as const,
    items: packageCharacters.value,
    versions: characterVersions.value,
  },
  {
    key: "preset" as const,
    label: labels.preset,
    id: "preset_id" as const,
    version: "preset_version_id" as const,
    items: presets.value,
    versions: presetVersions.value,
  },
  {
    key: "worldbook" as const,
    label: labels.worldbook,
    id: "worldbook_id" as const,
    version: "worldbook_version_id" as const,
    items: worldbooks.value,
    versions: worldbookVersions.value,
  },
  {
    key: "regex" as const,
    label: labels.regex,
    id: "regex_profile_id" as const,
    version: "regex_profile_version_id" as const,
    items: regexes.value,
    versions: regexVersions.value,
  },
]);
const appReleases = computed(() =>
  releases.value.filter(
    (release) =>
      release.character_id === selected.value?.configuration.character_id,
  ),
);
const activeRelease = computed(() =>
  activeReleases.value.find(
    (item) => item.character_id === selected.value?.configuration.character_id,
  ),
);
const currentPublished = computed(
  () =>
    !!selected.value &&
    roleConfigurationIsPublished(
      selected.value.configuration,
      activeRelease.value,
    ),
);
async function setPublication(releaseId: string, active: boolean) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    await apiClient.roleReleases.setPublication({ releaseId, active });
    activeReleases.value = await apiClient.roleReleases.list({
      activeOnly: true,
    });
    notice.value = labels.publicationChanged;
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
const timelineEntries = computed(() =>
  floors.value
    .filter((floor) => floor.floorNo >= 0)
    .slice()
    .sort((left, right) => left.floorNo - right.floorNo)
    .map((floor) => ({
      floor,
      messages: roleSessionTimelineMessages(floor),
    })),
);
function messageRoleLabel(role: string) {
  switch (role) {
    case "user":
      return labels.messageRoles.user;
    case "assistant":
      return labels.messageRoles.assistant;
    case "narrator":
      return labels.messageRoles.narrator;
    case "system":
      return labels.messageRoles.system;
    default:
      return role;
  }
}
function messageSpeakerName(role: string) {
  const boundName =
    role === "user"
      ? sessionDetail.value?.userBinding?.snapshotSummary?.name
      : role === "assistant"
        ? sessionDetail.value?.characterBinding?.snapshotSummary?.name
        : undefined;
  return boundName?.trim() || messageRoleLabel(role);
}
function floorState(state: string) {
  return labels.floorStates[state as keyof typeof labels.floorStates] ?? state;
}
let sessionRequest = 0;
async function selectSession(id: string, branchId?: string) {
  const request = ++sessionRequest;
  selectedSessionId.value = id;
  timelineBranch.value = branchId ?? "main";
  hasMore.value = false;
  timelineBusy.value = true;
  failure.value = "";
  floors.value = [];
  sessionDetail.value = undefined;
  activeFloor.value = undefined;
  view.value = "records";
  navOpen.value = false;
  try {
    const [detail, timeline] = await Promise.all([
      apiClient.sessions.getDetail({ sessionId: id }),
      apiClient.sessions.timeline({
        sessionId: id,
        branchId,
        limit: labels.pageSize,
        offset: 0,
      }),
    ]);
    if (request !== sessionRequest) return;
    sessionDetail.value = detail;
    floors.value = timeline.floors;
    timelineBranch.value = timeline.branchId ?? "main";
    hasMore.value = timeline.floors.length === labels.pageSize;
    const url = new URL(window.location.href);
    url.searchParams.set("sessionId", id);
    for (const key of ["floorId", "branchId", "runId", "pageId", "callId"])
      url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  } catch (error) {
    if (request === sessionRequest) report(error);
  } finally {
    if (request === sessionRequest) timelineBusy.value = false;
  }
}
async function moreFloors() {
  if (timelineBusy.value || !selectedSessionId.value) return;
  const request = sessionRequest;
  timelineBusy.value = true;
  failure.value = "";
  try {
    const next = await apiClient.sessions.timeline({
      sessionId: selectedSessionId.value,
      branchId: timelineBranch.value,
      limit: labels.pageSize,
      offset: floors.value.length,
    });
    if (request !== sessionRequest) return;
    floors.value.push(...next.floors);
    hasMore.value = next.floors.length === labels.pageSize;
  } catch (error) {
    if (request === sessionRequest) report(error);
  } finally {
    if (request === sessionRequest) timelineBusy.value = false;
  }
}
async function renameSession() {
  if (!selectedSessionId.value || !renameValue.value.trim() || busy.value)
    return;
  busy.value = true;
  failure.value = "";
  try {
    await apiClient.sessions.update({
      sessionId: selectedSessionId.value,
      title: renameValue.value.trim(),
    });
    if (selected.value)
      previews.value = await apiClient.roleApps.listPreviews({
        id: selected.value.id,
      });
    formalSessions.value = await listFormalRoleSessions(
      apiClient,
      labels.pageSize,
    );
    renameOpen.value = false;
    events.value.unshift(labels.renameSaved);
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function archiveSession() {
  if (!currentPreview.value || busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    const status =
      currentPreview.value.status === "archived" ? "active" : "archived";
    await apiClient.sessions.update({
      sessionId: currentPreview.value.id,
      status,
    });
    if (selected.value)
      previews.value = await apiClient.roleApps.listPreviews({
        id: selected.value.id,
      });
    formalSessions.value = await listFormalRoleSessions(
      apiClient,
      labels.pageSize,
    );
    sessionFilter.value = status;
    events.value.unshift(
      status === "archived" ? labels.archiveSaved : labels.restoreSaved,
    );
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
async function refreshResources() {
  [
    characters.value,
    nativeCards.value,
    presets.value,
    worldbooks.value,
    regexes.value,
    users.value,
    models.value,
  ] = await Promise.all([
    apiClient.characters.list(),
    apiClient.nativeCards.list(),
    apiClient.presets.list(),
    apiClient.worldbooks.list(),
    apiClient.regexProfiles.list(),
    apiClient.users.list(),
    apiClient.llmProfiles.list(),
  ]);
  await Promise.all([
    versions("character", false),
    versions("preset", false),
    versions("worldbook", false),
    versions("regex", false),
  ]);
}
function openResource(kind: string, id?: string) {
  if (kind === "character") {
    const href = nativeCardEditorHref(
      nativeCardEditorConfig.path,
      nativeCards.value,
      id,
    );
    if (!href) {
      notice.value = labels.characterPackageMissing;
      return;
    }
    navigate(() => {
      allowConfirmedNavigationUnload = true;
      window.location.assign(href);
    }, true);
    navOpen.value = false;
    return;
  }
  navigate(() => {
    libraryEditing.value = !!id;
    resourceId.value = id;
    libraryKind.value = kind as RoleResourceKind;
    view.value = "library";
    navOpen.value = false;
  });
}
let runtimeRequest = 0;
async function openRuntime(key: string) {
  const request = ++runtimeRequest;
  const sessionId = selectedSessionId.value;
  navOpen.value = false;
  if (key === "tools" || key === "mcp") {
    if (!selectedSessionId.value) {
      failure.value = labels.chooseTrial;
      return;
    }
    try {
      await managers.value?.selectSession(sessionId);
      if (request !== runtimeRequest || sessionId !== selectedSessionId.value)
        return;
      if (key === "tools") managers.value?.openTools();
      else managers.value?.openMcp();
    } catch (error) {
      report(error);
    }
  } else goView(key);
}
function openGeneration(floor: TimelineFloor) {
  initialDetailCall.value = undefined;
  initialDetailRun.value = undefined;
  const url = new URL(window.location.href);
  for (const key of ["runId", "callId", "pageId"]) url.searchParams.delete(key);
  url.searchParams.set("floorId", floor.id);
  url.searchParams.set("branchId", timelineBranch.value);
  window.history.replaceState(null, "", url);
  activeFloor.value = floor;
  view.value = "generation";
  tab.value = "generationDetail";
}
function closeGeneration() {
  view.value = "records";
  const url = new URL(window.location.href);
  for (const key of ["floorId", "branchId", "runId", "pageId", "callId"])
    url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
}
function changeApp(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const item = apps.value.find((entry) => entry.id === id);
  if (item)
    navigate(() => {
      void select(item).catch(report);
    }, true);
  (event.target as HTMLSelectElement).value = selected.value?.id ?? "";
}
function closeDrawer() {
  navOpen.value = false;
  inspectorOpen.value = false;
}
onMounted(() => {
  void load();
  window.addEventListener("resize", clampPaneWidths);
  window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => {
  ++appRequest;
  ++sessionRequest;
  stopPaneResize();
  window.removeEventListener("resize", clampPaneWidths);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>
<template>
  <div
    class="role-workspace"
    :class="{ 'generation-focused': view === 'generation' }"
    :style="paneLayoutStyles"
  >
    <header class="topbar">
      <div class="brand">◇ Tavern<span>Headless</span></div>
      <div class="row">
        <span class="tag">{{ labels.admin }}</span>
        <label
          >{{ labels.account
          }}<select :aria-label="labels.account">
            <option
              v-for="account in accounts.filter((item) => item.isDefault)"
              :key="account.id"
              :value="account.id"
            >
              {{ account.name }}
            </option>
          </select></label
        >
        <button @click="locale = locale === 'en' ? 'zh-CN' : 'en'">
          {{ locale === "en" ? "中文" : "EN" }}
        </button>
        <button
          class="mobile-toggle"
          @click="
            navOpen = !navOpen;
            inspectorOpen = false;
          "
        >
          {{ labels.navigation }}
        </button>
        <button
          class="mobile-toggle"
          @click="
            inspectorOpen = !inspectorOpen;
            navOpen = false;
          "
        >
          {{ labels.inspector }}
        </button>
      </div>
    </header>
    <div class="workspace" :inert="appLoading" :aria-busy="appLoading">
      <button
        v-if="navOpen || inspectorOpen"
        class="drawer-backdrop"
        :aria-label="labels.close"
        @click="closeDrawer"
      />
      <nav
        class="sidebar"
        :class="{ 'drawer-open': navOpen }"
        :aria-label="labels.workspaceNav"
      >
        <section>
          <div class="caption">{{ labels.title }}</div>
          <select
            class="navitem app-select"
            :aria-label="labels.allApps"
            :value="selected?.id ?? ''"
            :disabled="busy || !apps.length"
            @change="changeApp"
          >
            <option v-if="!selected" value="" disabled>{{ labels.new }}</option>
            <option v-for="item in apps" :key="item.id" :value="item.id">
              {{ item.configuration.name }}
            </option>
          </select>
          <p class="small">
            {{ labels.configurationRevision }} {{ selected?.revision ?? "—" }}
          </p>
          <button
            class="navitem"
            @click="
              goView('configuration');
              tab = 'configuration';
            "
          >
            {{ labels.roleConfiguration }}
          </button>
        </section>
        <section class="box">
          <div class="row">
            <h2>{{ labels.trial }}</h2>
            <span class="small"
              >{{ previews.length }} {{ labels.trialCountUnit }}</span
            >
          </div>
          <button class="navitem" :disabled="busy || dirty" @click="preview()">
            {{ previews.length ? labels.newTrial : labels.preview }}
          </button>
          <label class="field"
            >{{ labels.trialStatus
            }}<select v-model="sessionFilter">
              <option value="active">{{ labels.activeTrials }}</option>
              <option value="archived">{{ labels.archivedTrials }}</option>
            </select></label
          >
          <button
            v-for="item in visiblePreviews"
            :key="item.id"
            class="navitem"
            :class="{ active: selectedSessionId === item.id }"
            @click="navigate(() => selectSession(item.id))"
          >
            {{ item.title ?? item.id }}<br /><span class="small"
              >{{ labels.configurationRevision }}
              {{ item.draft_revision }}</span
            >
          </button>
          <p v-if="!visiblePreviews.length" class="small">{{ labels.empty }}</p>
        </section>
        <section v-if="visibleFormalSessions.length" class="box">
          <h2>{{ labels.userConversations }}</h2>
          <button
            v-for="item in visibleFormalSessions"
            :key="item.id"
            class="navitem"
            :class="{ active: selectedSessionId === item.id }"
            @click="navigate(() => selectSession(item.id))"
          >
            {{ item.title ?? item.id }}
          </button>
        </section>
        <section class="box">
          <div class="caption">{{ labels.library }}</div>
          <button
            v-for="resource in resources"
            :key="resource.key"
            class="navitem"
            :class="{
              active: view === 'library' && libraryKind === resource.key,
            }"
            @click="openResource(resource.key)"
          >
            {{ resource.label }} {{ resource.items.length }}
          </button>
        </section>
        <section class="box">
          <h2>{{ labels.runtime }}</h2>
          <button
            v-for="item in labels.runtimeItems"
            :key="item.key"
            class="navitem"
            @click="openRuntime(item.key)"
          >
            {{ item.label }}
          </button>
        </section>
        <section class="sidebar-footer box">
          <div class="caption">{{ labels.service }}</div>
          <p class="small">{{ labels.serviceHint }}</p>
          <button
            @click="
              goView('service');
              navOpen = false;
            "
          >
            {{ labels.serviceLocation }}
          </button>
        </section>
      </nav>
      <div
        class="resize-handle"
        role="separator"
        tabindex="0"
        :aria-label="labels.leftResize"
        @mousedown="beginPaneResize('left', $event)"
        @keydown="
          resizePaneByKeyboard('left', $event, labels.layout.keyboardResizeStep)
        "
      />
      <main class="canvas">
        <div id="mainView">
          <RoleResourceLibrary
            v-if="view === 'library'"
            ref="resourceEditor"
            :key="libraryKind + resourceId"
            :kind="libraryKind"
            :resource-id="resourceId"
            @editing="libraryEditing = $event"
            @close="goView('records')"
            @changed="refreshResources"
          />
          <div v-show="view !== 'library' || !libraryEditing">
            <RoleGenerationDetail
              v-if="view === 'generation' && activeFloor"
              :key="activeFloor.id"
              :floor="activeFloor"
              :session-title="currentPreview?.title ?? undefined"
              :session-id="selectedSessionId"
              :branch-id="timelineBranch"
              :floors="generationFloors"
              :initial-call="initialDetailCall"
              :initial-run-id="initialDetailRun"
              @select="openGeneration"
              @close="closeGeneration"
            />
            <section v-else-if="view === 'service'" class="panel">
              <h1>{{ labels.service }}</h1>
              <p>{{ labels.servicePaths }}</p>
              <button @click="view = 'records'">{{ labels.back }}</button>
            </section>
            <section
              v-else-if="view === 'configuration' || view === 'runtime'"
              class="panel"
            >
              <div class="toolbar">
                <h1>
                  {{
                    view === "runtime"
                      ? labels.modelSlots
                      : labels.roleConfiguration
                  }}
                </h1>
                <button @click="navigate(fresh, true)">{{ labels.new }}</button
                ><button @click="view = 'records'">{{ labels.back }}</button>
              </div>
              <label class="field"
                >{{ labels.name }}<input v-model="form.name" required
              /></label>
              <template v-if="view === 'runtime'">
                <div
                  v-for="slot in form.model_slots"
                  :key="slot.slot"
                  class="box model-editor"
                >
                  <h2>
                    {{ slot.slot === "narrator" ? labels.narrator : slot.slot }}
                  </h2>
                  <label class="field"
                    >{{ labels.model
                    }}<select v-model="slot.profile_id">
                      <option disabled value="">{{ labels.choose }}</option>
                      <option
                        v-for="model in models"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.presetName }} · {{ model.modelId }}
                      </option>
                    </select></label
                  >
                  <RoleGenerationParams
                    :key="`${selected?.id}:${selected?.revision}:${slot.slot}`"
                    v-model="slot.params"
                    :draft="runtimeDrafts[slot.slot]"
                    @draft="runtimeDrafts[slot.slot] = $event"
                    @validity="runtimeValidity(slot.slot, $event)"
                  />
                </div>
                <label class="field"
                  >{{ labels.promptMode
                  }}<select v-model="form.prompt_mode">
                    <option value="compat_plus">compat_plus</option>
                    <option value="compat_strict">compat_strict</option>
                    <option value="native">native</option>
                  </select></label
                >
              </template>
              <div v-else class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{{ labels.resourceName }}</th>
                      <th>{{ labels.versionId }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in resourceBindings" :key="item.kind">
                      <td>{{ item.kind }} · {{ item.name }}</td>
                      <td>{{ item.version }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <section class="box">
                <h2>{{ nativeCardEditorConfig.labels.previewStatePrompt }}</h2>
                <label class="field"
                  >{{ nativeCardEditorConfig.labels.statePromptPreset
                  }}<select
                    :value="form.statePresetId ?? ''"
                    @change="
                      setStatePreset(($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="">
                      {{ nativeCardEditorConfig.labels.useProfilePreset }}
                    </option>
                    <option
                      v-for="item in presets"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.name }}
                    </option>
                  </select></label
                >
                <label v-if="form.statePresetId" class="field"
                  >{{ nativeCardEditorConfig.labels.statePromptPresetVersion
                  }}<select v-model="form.statePresetVersionId">
                    <option disabled value="">
                      {{
                        nativeCardEditorConfig.labels.chooseStatePresetVersion
                      }}
                    </option>
                    <option
                      v-for="item in statePresetVersions"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.versionNo }} · {{ item.id }}
                    </option>
                  </select></label
                >
                <label class="field"
                  >{{ nativeCardEditorConfig.labels.stateHistoryTurns
                  }}<input
                    type="number"
                    min="0"
                    step="1"
                    :placeholder="String(roleStatePolicy.defaultHistoryTurns)"
                    :value="form.stateHistoryTurns ?? ''"
                    @input="
                      setStateHistoryTurns(
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                /></label>
              </section>
              <p v-if="dirty" class="small">{{ labels.unsaved }}</p>
              <div class="actions">
                <button
                  :disabled="busy || !dirty || !!invalidRuntimeSlots.size"
                  class="primary"
                  @click="save"
                >
                  {{ labels.save }}</button
                ><button
                  :disabled="!selected || busy || !dirty"
                  @click="selected && select(selected)"
                >
                  {{ labels.undo }}</button
                ><button class="mobile-toggle" @click="inspectorOpen = true">
                  {{ labels.roleConfiguration }}
                </button>
              </div>
              <button :disabled="checking || busy" @click="checkConfiguration">
                {{ labels.check }}
              </button>
              <p v-if="checked" class="small">{{ labels.checkPassed }}</p>
              <details v-if="bindingSummary">
                <summary>{{ labels.runtimeFiles }}</summary>
                <pre>{{ bindingSummary }}</pre>
              </details>
            </section>
            <RoleSessionPanel
              v-else-if="
                !['records', 'configuration', 'generation', 'library'].includes(
                  view,
                )
              "
              ref="sessionPanel"
              :key="view + selectedSessionId"
              :panel="view"
              :branch-id="timelineBranch"
              :floor-id="activeFloor?.id ?? generationFloors.at(-1)?.id"
              :page-id="
                (activeFloor ?? generationFloors.at(-1))?.activePages.at(-1)?.id
              "
              :session-id="selectedSessionId"
              @close="goView('records')"
              @changed="
                view === 'session-config' &&
                selectedSessionId &&
                selectSession(selectedSessionId)
              "
            />
            <section v-else class="trial-records">
              <template v-if="currentPreview">
                <header class="session-header">
                  <div class="session-heading">
                    <div class="session-title-line">
                      <span class="caption">{{
                        isFormalSession
                          ? labels.userConversationRecord
                          : labels.trialRecord
                      }}</span>
                      <h1>{{ currentPreview.title ?? currentPreview.id }}</h1>
                    </div>
                    <p class="small session-meta">
                      <template
                        v-if="currentPreview.draft_revision !== undefined"
                        >{{ labels.configurationRevision }}
                        {{ currentPreview.draft_revision }} ·
                      </template>
                      {{
                        currentPreview.status === "archived"
                          ? labels.archived
                          : labels.active
                      }}
                      · {{ generationFloors.length }}{{ hasMore ? "+" : "" }}
                      {{ labels.rounds }}
                    </p>
                  </div>
                  <div class="session-actions">
                    <button
                      class="primary"
                      :disabled="busy"
                      @click="preview(currentPreview.id)"
                    >
                      {{
                        isFormalSession
                          ? labels.continueUserChat
                          : labels.continue
                      }}
                    </button>
                    <button @click="view = 'session-config'">
                      {{ labels.sessionConfiguration }}</button
                    ><button @click="view = 'variables'">
                      {{ labels.variables }}</button
                    ><button @click="view = 'memory'">
                      {{ labels.memory }}</button
                    ><button @click="view = 'branches'">
                      {{ labels.branches }}
                    </button>
                    <button
                      @click="
                        renameValue = currentPreview.title ?? '';
                        renameOpen = true;
                      "
                    >
                      {{ labels.rename }}</button
                    ><button :disabled="busy" @click="archiveSession">
                      {{
                        currentPreview.status === "archived"
                          ? labels.restore
                          : labels.archive
                      }}</button
                    ><button
                      class="danger"
                      :disabled="busy"
                      @click="deleteTarget = currentPreview.id"
                    >
                      {{ labels.deleteShort }}
                    </button>
                  </div>
                </header>
                <p v-if="timelineBusy" role="status">{{ labels.loading }}</p>
                <div
                  v-for="entry in timelineEntries"
                  :key="entry.floor.id"
                  class="floor-row"
                  :class="{ 'opening-row': entry.floor.floorNo === 0 }"
                >
                  <div class="floor-row-content">
                    <div v-if="entry.floor.floorNo > 0" class="round-heading">
                      <div>
                        <strong
                          >{{ labels.roundPrefix }} {{ entry.floor.floorNo }}
                          {{ labels.round }}</strong
                        ><span class="tag">{{
                          floorState(entry.floor.state)
                        }}</span>
                      </div>
                      <span class="small">{{ timelineBranch }}</span>
                    </div>
                    <div
                      v-if="entry.messages.length"
                      class="timeline-message-list"
                    >
                      <article
                        v-for="message in entry.messages"
                        :key="message.id"
                        class="message"
                        :class="{
                          user: message.role === 'user',
                          assistant:
                            message.role === 'assistant' ||
                            message.role === 'narrator',
                        }"
                      >
                        <div class="speaker">
                          <div class="speaker-identity">
                            <strong>{{
                              messageSpeakerName(message.role)
                            }}</strong>
                            <span
                              v-if="
                                messageSpeakerName(message.role) !==
                                messageRoleLabel(message.role)
                              "
                              class="small"
                              >{{ messageRoleLabel(message.role) }}</span
                            >
                          </div>
                        </div>
                        <MarkdownBlock
                          v-if="
                            message.contentFormat === 'markdown' ||
                            message.contentFormat === 'json'
                          "
                          :content="message.content"
                          :format="
                            message.contentFormat === 'json'
                              ? 'json'
                              : 'markdown'
                          "
                        />
                        <p v-else>{{ message.content }}</p>
                      </article>
                    </div>
                    <p v-else class="floor-message-empty small">
                      {{ labels.emptyMessages }}
                    </p>
                  </div>
                  <button
                    v-if="entry.floor.floorNo > 0"
                    @click="openGeneration(entry.floor)"
                  >
                    {{ labels.viewGeneration }}
                  </button>
                </div>
                <p
                  v-if="!generationFloors.length && !timelineBusy && !failure"
                  class="small"
                >
                  {{ labels.noRecords }}
                </p>
                <button
                  v-if="hasMore"
                  :disabled="timelineBusy"
                  @click="moreFloors"
                >
                  {{ labels.loadMore }}
                </button>
              </template>
              <template v-else
                ><h1>
                  {{
                    isFormalSession
                      ? labels.userConversationRecord
                      : labels.trialRecord
                  }}
                </h1>
                <p>{{ labels.chooseTrial }}</p>
                <button
                  class="primary"
                  :disabled="dirty || busy"
                  @click="preview()"
                >
                  {{ labels.preview }}
                </button></template
              >
            </section>
          </div>
          <div id="notice" class="small" role="status" aria-live="polite">
            <span v-if="failure" role="alert" class="inline-error"
              >{{ failure }}
              <button @click="load">{{ labels.retry }}</button></span
            ><span v-else>{{ busy ? labels.loading : notice }}</span>
            <details v-if="failureDetails">
              <summary>{{ labels.missingDetails }}</summary>
              <pre>{{ failureDetails }}</pre>
            </details>
          </div>
        </div>
      </main>
      <div
        class="resize-handle"
        role="separator"
        tabindex="0"
        :aria-label="labels.rightResize"
        @mousedown="beginPaneResize('right', $event)"
        @keydown="
          resizePaneByKeyboard(
            'right',
            $event,
            labels.layout.keyboardResizeStep,
          )
        "
      />
      <aside class="inspector" :class="{ 'drawer-open': inspectorOpen }">
        <div class="tabs" :aria-label="labels.inspector">
          <button
            v-for="key in ['configuration', 'trialDetail', 'generationDetail']"
            :key="key"
            :aria-selected="tab === key"
            @click="tab = key"
          >
            {{
              labels[
                key as "configuration" | "trialDetail" | "generationDetail"
              ]
            }}
          </button>
        </div>
        <div class="inspector-body">
          <template v-if="tab === 'configuration'">
            <div class="row">
              <h2>{{ labels.roleConfiguration }}</h2>
              <span class="tag">{{
                dirty ? labels.unsaved : labels.clean
              }}</span>
            </div>
            <div v-for="binding in bindings" :key="binding.key" class="binding">
              <div class="row">
                <span>{{ labels.bindingUsage }}{{ binding.label }}</span
                ><button @click="openResource(binding.key)">
                  {{ labels.manage }}{{ binding.label }}
                </button>
              </div>
              <select
                v-model="form[binding.id]"
                :aria-label="labels.bindingUsage + binding.label"
                :disabled="busy"
                @change="versions(binding.key)"
              >
                <option v-if="binding.key === 'worldbook'" :value="null">
                  {{ labels.none }}
                </option>
                <option v-else-if="binding.key === 'regex'" :value="null">
                  {{ labels.noRegex }}
                </option>
                <option v-else disabled value="">{{ labels.choose }}</option>
                <option
                  v-if="
                    binding.key === 'character' &&
                    form.character_id &&
                    !boundCharacterHasPackage
                  "
                  :value="form.character_id"
                  disabled
                >
                  {{ boundCharacterName }}
                </option>
                <option
                  v-for="item in binding.items"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.name }}
                </option>
              </select>
              <label
                v-if="binding.key !== 'regex' || form.regex_profile_id"
                class="field"
                >{{ binding.label }}{{ labels.version
                }}<select
                  v-model="form[binding.version]"
                  :aria-label="binding.label + labels.version"
                  :disabled="busy || !form[binding.id]"
                >
                  <option
                    :value="binding.key === 'worldbook' ? null : ''"
                    disabled
                  >
                    {{ labels.choose }}
                  </option>
                  <option
                    v-if="
                      binding.key === 'character' &&
                      form.character_version_id &&
                      !binding.versions.some(
                        (version) => version.id === form.character_version_id,
                      )
                    "
                    :value="form.character_version_id"
                    disabled
                  >
                    {{ form.character_version_id }}
                  </option>
                  <option
                    v-for="version in binding.versions"
                    :key="version.id"
                    :value="version.id"
                  >
                    v{{ version.versionNo
                    }}{{
                      version.versionNo ===
                      Math.max(
                        ...binding.versions.map((item) => item.versionNo),
                      )
                        ? ` · ${labels.latest}`
                        : ""
                    }}
                  </option>
                </select></label
              >
              <div class="actions">
                <button
                  :disabled="
                    binding.key === 'character'
                      ? !boundCharacterHasPackage
                      : !form[binding.id]
                  "
                  @click="
                    openResource(binding.key, form[binding.id] ?? undefined)
                  "
                >
                  {{ labels.edit }}{{ binding.label }}
                </button>
              </div>
              <p
                v-if="
                  binding.key === 'character' &&
                  form.character_id &&
                  !boundCharacterHasPackage
                "
                class="small"
              >
                {{ labels.characterPackageMissing }}
              </p>
            </div>
            <div class="binding">
              <div class="row">
                <span>{{ labels.bindingUsage }}{{ labels.model }}</span
                ><button @click="openResource('model')">
                  {{ labels.manage }}{{ labels.model }}
                </button>
              </div>
              <select
                v-if="form.model_slots[0]"
                v-model="form.model_slots[0].profile_id"
                :aria-label="labels.model"
              >
                <option disabled value="">{{ labels.choose }}</option>
                <option v-for="item in models" :key="item.id" :value="item.id">
                  {{ item.presetName }}
                </option>
              </select>
              <div class="actions">
                <button
                  @click="
                    openResource('model', form.model_slots[0]?.profile_id)
                  "
                >
                  {{ labels.edit }}{{ labels.model }}
                </button>
              </div>
            </div>
            <div class="binding">
              <div class="row">
                <span
                  >{{ labels.bindingUsage }}{{ labels.personaResource }}</span
                ><button @click="openResource('persona')">
                  {{ labels.manage }}{{ labels.personaResource }}
                </button>
              </div>
              <select
                v-model="form.default_user_id"
                :aria-label="labels.personaResource"
              >
                <option disabled value="">{{ labels.choose }}</option>
                <option v-for="item in users" :key="item.id" :value="item.id">
                  {{ item.name }}
                </option>
              </select>
              <div class="actions">
                <button @click="openResource('persona', form.default_user_id)">
                  {{ labels.edit }}{{ labels.personaResource }}
                </button>
              </div>
            </div>
            <div class="actions">
              <button
                @click="
                  goView('runtime');
                  inspectorOpen = false;
                "
              >
                {{ labels.modelSlots }}
              </button>
            </div>
            <div class="actions">
              <button
                class="primary"
                :disabled="busy || !dirty || !!invalidRuntimeSlots.size"
                @click="save"
              >
                {{ labels.save }}</button
              ><button
                :disabled="!selected || busy || !dirty"
                @click="selected && select(selected)"
              >
                {{ labels.undo }}
              </button>
            </div>
            <button :disabled="busy || dirty" @click="preview()">
              {{ labels.usePreview }}
            </button>
            <section class="box publication-panel">
              <h2>{{ labels.publishHeading }}</h2>
              <div
                v-if="!busy && configurationIssues.length"
                role="alert"
                class="danger"
              >
                <p>{{ labels.invalidConfiguration }}</p>
                <ul>
                  <li
                    v-for="issue in configurationIssues"
                    :key="issue.path + issue.message"
                  >
                    {{ issue.path }}<br /><small>{{ issue.message }}</small>
                  </li>
                </ul>
              </div>
              <div v-if="failure" role="alert">
                <p class="danger">{{ failure }}</p>
                <dl>
                  <template v-for="field in errorFields" :key="field.key"
                    ><dt>{{ field.key }}</dt>
                    <dd>{{ field.value }}</dd></template
                  >
                </dl>
              </div>
              <button :disabled="checking || busy" @click="checkConfiguration">
                {{ labels.check }}
              </button>
              <p v-if="checked" class="small">{{ labels.checkPassed }}</p>
              <details v-if="bindingSummary">
                <summary>{{ labels.runtimeFiles }}</summary>
                <ul>
                  <li v-for="file in bindingSummary.files" :key="file.name">
                    {{ file.name }} · {{ file.purpose }} · {{ file.byteSize }} B
                  </li>
                </ul>
              </details>
              <p class="small">
                {{
                  activeRelease
                    ? `${labels.currentPublication}: ${activeRelease.name}`
                    : labels.publicationStopped
                }}
              </p>
              <p class="small">{{ labels.publicationHint }}</p>
              <button
                :disabled="
                  busy ||
                  dirty ||
                  currentPublished ||
                  !!configurationIssues.length
                "
                @click="publish"
              >
                {{
                  currentPublished ? labels.alreadyPublished : labels.publish
                }}
              </button>
              <button
                :disabled="busy || !activeRelease"
                @click="
                  activeRelease && setPublication(activeRelease.id, false)
                "
              >
                {{ labels.stopPublication }}
              </button>
              <h2 class="records-heading">{{ labels.releaseHistory }}</h2>
              <p v-if="!appReleases.length" class="small">
                {{ labels.noReleases }}
              </p>
              <details
                v-for="release in appReleases"
                :key="release.id"
                class="version"
              >
                <summary>
                  {{ labels.releaseVersion }} {{ release.id }}
                  <span v-if="activeRelease?.id === release.id"
                    >· {{ labels.currentPublication }}</span
                  >
                </summary>
                <button
                  v-if="activeRelease?.id !== release.id"
                  :disabled="busy"
                  @click="setPublication(release.id, true)"
                >
                  {{ labels.activatePublication }}
                </button>
                <pre>{{ release }}</pre>
              </details>
            </section>
          </template>
          <template v-else-if="tab === 'trialDetail'"
            ><h2>{{ labels.trialDetail }}</h2>
            <button
              :disabled="timelineBusy || !selectedSessionId"
              @click="selectSession(selectedSessionId)"
            >
              {{ labels.refresh }}</button
            ><template v-if="sessionDetail"
              ><p>{{ labels.sessionId }}<br />{{ sessionDetail.id }}</p>
              <p>
                {{ labels.createdAt }}<br />{{
                  new Date(sessionDetail.createdAt).toLocaleString()
                }}
              </p>
              <details>
                <summary>{{ labels.bindings }}</summary>
                <pre>{{ sessionDetail }}</pre>
              </details></template
            >
            <p v-else>{{ labels.chooseTrial }}</p></template
          >
          <template v-else
            ><h2>{{ labels.generationDetail }}</h2>
            <template v-if="activeFloor"
              ><p>
                {{ labels.roundPrefix }} {{ activeFloor.floorNo }}
                {{ labels.round }} · {{ floorState(activeFloor.state) }}
              </p>
              <button
                @click="
                  view = 'generation';
                  inspectorOpen = false;
                "
              >
                {{ labels.viewGeneration }}
              </button></template
            >
            <p v-else>{{ labels.selectGeneration }}</p></template
          >
        </div>
        <section class="box">
          <h2>{{ labels.events }}</h2>
          <div class="event-list">
            <p v-for="(event, index) in events" :key="index" class="small">
              {{ event }}
            </p>
            <p v-if="!events.length" class="small">{{ labels.noEvents }}</p>
          </div>
        </section>
      </aside>
    </div>
    <div
      v-if="renameOpen || deleteTarget"
      class="modal-backdrop"
      @click.self="
        if (!busy) {
          renameOpen = false;
          deleteTarget = '';
        }
      "
    >
      <form
        v-modal-focus="
          () => {
            if (!busy) {
              renameOpen = false;
              deleteTarget = '';
            }
          }
        "
        class="modal-card"
        role="dialog"
        aria-modal="true"
        :aria-label="deleteTarget ? labels.delete : labels.rename"
        @submit.prevent="deleteTarget ? remove(deleteTarget) : renameSession()"
      >
        <h2>{{ deleteTarget ? labels.delete : labels.rename }}</h2>
        <p v-if="deleteTarget">{{ labels.deleteConfirm }}</p>
        <label v-else class="field"
          >{{ labels.namePrompt
          }}<input v-model="renameValue" required maxlength="200"
        /></label>
        <div class="actions">
          <button
            type="button"
            :disabled="busy"
            @click="
              renameOpen = false;
              deleteTarget = '';
            "
          >
            {{ labels.cancel }}</button
          ><button type="submit" class="primary" :disabled="busy">
            {{ labels.confirm }}
          </button>
        </div>
      </form>
    </div>
    <div v-if="pendingNavigation" class="modal-backdrop">
      <div
        v-modal-focus="cancelNavigation"
        class="modal-card"
        role="dialog"
        aria-modal="true"
      >
        <p>
          {{ discardsConfiguration ? labels.allChanges : labels.editorChanges }}
        </p>
        <button @click="cancelNavigation">
          {{ labels.keepEditing }}</button
        ><button @click="discardAndNavigate">{{ labels.discard }}</button>
      </div>
    </div>
    <ManagersHost ref="managers" embedded />
  </div>
</template>
<style scoped src="./role-workspace.css"></style>
