<script setup lang="ts">
import { apiErrorMessages, publicConfigurationFiles, getNativeCardCreationTemplate, getNativeCardPackageFileRule, nativeCardFileRules, nativeCardWorldbookSchema, roleAdminWebConfigSchema, roleReleasePromptModes, roleStatePolicy, stateUpdaterSlot, type NativeCard, type NativeCardBuildSource, type NativeCardIssue, type NativeCardSystemConfiguration } from "@tavern/shared";
import type { CharacterListItem, LlmProfile, LlmRuntimeSlot, PresetListItem, UserRecord } from "@tavern/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { vModalFocus } from "../../directives/modal-focus.js";
import { apiClient } from "../../lib/api.js";
import { createNativeCardEditorController } from "./controller.js";
import { saveAndContinueLabel, saveThenRunAction } from "./action-flow.js";
import { createDialogFocusReturn, focusDialogEntry, restoreAsyncActionFocus } from "./dialog-focus.js";
import { nativeCardIssuesFromError } from "./failure-issues.js";
import { nativeCardHumanError } from "./native-card-error.js";
import { nativeCardPathFailure } from "./native-card-path-failure.js";
import { findPackageFileReferences, isFixedPackageFile, isPackageFileReadable } from "./file-operations.js";
import { orderDomainFiles } from "./domain-file-order.js";
import { createOpeningInitialState } from "./opening-initial-state.js";
import { parseProposalInspectionInput } from "./proposal-inspection-input.js";
import { buildNativeCardSystemConfiguration } from "./system-configuration.js";
import { allocateWorldbookEntryUidFromServer, moveWorldbookEntryBindings } from "./worldbook-entry-operations.js";
import { isNativeCardMediaReplacementCompatible, resolveNativeCardUploadMediaType } from "./native-card-upload-media.js";
import { formatJsonSyntaxError } from "./json-syntax-error.js";
import { createPublishedReleaseSession } from "./publication-session.js";
import { nativeCardEditorConfig as config, type NativeCardEditorLabel } from "./config.js";
import "./native-card-editor.css";

type JsonObject = Record<string, unknown>;
type PreviewTab = "page" | "prompt" | "state-prompt" | "variables" | "trial";
type DialogKind = "create" | "import" | "leave" | "before-action" | "check" | "conflict" | "settings" | "preview" | "publication" | "build" | "build-task" | "create-file" | "rename" | "delete" | "variable" | "bind" | "move-entry";
type EditorAction = "check" | "preview" | "publish" | "build";
type SystemAction = "preview" | "publish";
type Turn = { role: string; content: string };
type ImportStage = "select" | "checking" | "invalid" | "ready" | "importing" | "commit-failed" | "expired" | "complete";
type BuildSourceSummary = { revision: number; versionId?: string; name?: string; fileCount?: number };

const editor = createNativeCardEditorController(apiClient.nativeCards);
const dialogFocusReturn = createDialogFocusReturn();
const {
  cards,
  selectedCard,
  fileContents,
  dirty,
  importPreview,
  checkingImport,
  confirmingImport,
  loading,
  saving,
  validating,
  validation,
  conflict,
  publication,
  preview,
  build,
  failure,
  screen,
} = editor;
const labels = config.labels as Record<NativeCardEditorLabel, string>;
const dialog = ref<HTMLDialogElement>();
const dialogCloseButton = ref<HTMLButtonElement>();
const importInput = ref<HTMLInputElement>();
const importCheckButton = ref<HTMLButtonElement>();
const importRecheckButton = ref<HTMLButtonElement>();
const importConfirmButton = ref<HTMLButtonElement>();
const importRetryConfirmButton = ref<HTMLButtonElement>();
const importOpenCardButton = ref<HTMLButtonElement>();
const systemActionButton = ref<HTMLButtonElement>();
const dryRunButton = ref<HTMLButtonElement>();
const stateDryRunButton = ref<HTMLButtonElement>();
const variableRefreshButton = ref<HTMLButtonElement>();
const sendTrialButton = ref<HTMLButtonElement>();
const proposalInspectButton = ref<HTMLButtonElement>();
const selectedEntryFocusTarget = ref<HTMLButtonElement>();
const uploadInput = ref<HTMLInputElement>();
const editorScroll = ref<HTMLElement>();
const sourceEditor = ref<HTMLTextAreaElement>();
const importFile = ref<File>();
const importFailure = ref("");
const importStage = ref<ImportStage>("select");
const importedCard = ref<NativeCard>();
const openingInitialStateNotice = ref("");
const activeDialog = ref<DialogKind>();
const activeDomain = ref("character");
const activeFile = ref("character.json");
const editorMode = ref<"form" | "source">("form");
const navigation = ref<"domain" | "files">("domain");
const sidebarOpen = ref(false);
const search = ref("");
const selectedBook = ref("");
const selectedEntry = ref("");
const selectedOpening = ref("");
const newCardName = ref("");
const newFilePath = ref("");
const newFileRuleIndex = ref(0);
const variableKey = ref("");
const variableType = ref("string");
const variableDescription = ref("");
const bindingBookId = ref("");
const bindingEntryId = ref("");
const moveEntryTargetBookId = ref("");
const moveEntryBusy = ref(false);
const renameTo = ref("");
const pendingDeletePath = ref("");
const replaceTarget = ref("");
const pendingLeaveAction = ref<(() => void) | undefined>();
const pendingAction = ref<EditorAction>();
const operationFailure = ref("");
const toastMessage = ref("");
const toastTimer = ref<ReturnType<typeof setTimeout>>();
const checkedIssue = ref<NativeCardIssue>();
const selectedConflictPath = ref("");
const localPreviewChoice = ref<"keep-local" | "use-server">("keep-local");
const systemAction = ref<SystemAction>("preview");
const systemBusy = ref(false);
const publicationSessionBusy = ref(false);
const presetOptions = ref<PresetListItem[]>([]);
const presetVersionOptions = ref<Array<{ id: string; versionNo: number }>>([]);
const statePresetVersionOptions = ref<Array<{ id: string; versionNo: number }>>([]);
const userOptions = ref<UserRecord[]>([]);
const modelOptions = ref<LlmProfile[]>([]);
const runtimeModelOptions = ref<LlmRuntimeSlot[]>([]);
const selectedPreset = ref("");
const selectedPresetVersion = ref("");
const selectedStatePreset = ref("");
const selectedStatePresetVersion = ref("");
const selectedStateHistoryTurns = ref("");
const selectedUser = ref("");
const selectedNarratorModel = ref("");
const selectedStateUpdaterModel = ref("");
const selectedPromptMode = ref<(typeof roleReleasePromptModes)[number]>("native");
const selectedSessionType = ref<"individual" | "group">("individual");
const publicationNote = ref("");
const userWebBaseUrl = ref("");
const previewTab = ref<PreviewTab>("page");
const previewSessionId = ref("");
const previewSessionUrl = ref("");
const dryRunInput = ref("检查邮局的地图，再询问旧灯塔的位置。");
const dryRunResult = ref<Awaited<ReturnType<typeof apiClient.sessions.respondDryRun>>>();
const stateDryRunResult = ref<Awaited<ReturnType<typeof apiClient.roleRuntime.previewStateUpdate>>>();
const stateDryRunFloorId = ref("");
const roleView = ref<Awaited<ReturnType<typeof apiClient.roleRuntime.getView>>>();
const previewLoading = ref(false);
const previewFailure = ref("");
const trialInput = ref("");
const trialTurns = ref<Turn[]>([]);
const trialSending = ref(false);
const trialFailure = ref("");
const sourceMessagesJson = ref("");
const proposalJson = ref('{"changes":[],"evidenceMessageIds":[]}');
const proposalInspection = ref<Awaited<ReturnType<typeof apiClient.roleRuntime.inspectProposal>>>();
const proposalInspectionBusy = ref(false);
const proposalInspectionFailure = ref("");
const requestedPreviewTab = ref<PreviewTab>();
const buildSource = ref<NativeCardBuildSource>({ revision: 1 });
const buildEntryRevision = ref(1);
const buildEntrySummary = ref<BuildSourceSummary>();
const buildTaskSummary = ref<BuildSourceSummary>();
const buildTaskFailureAction = ref<"retry" | "download">();
const buildTaskFromSaved = ref(false);
const buildPoll = ref<ReturnType<typeof setInterval>>();
const pendingBuild = ref(false);
const mediaDataUrl = ref("");
const allowedPackageFiles = computed(() => nativeCardFileRules.versions["1.0.0"]!);
const fixedFile = computed(() => isFixedPackageFile(activeFile.value, allowedPackageFiles.value.fixedFiles));
const stateUpdateRequired = computed(() => Boolean(stringValue(parseFile("character.json")?.stateUpdate)));
const stateProfileHasDefaultPreset = computed(() => {
  const profile = parseFile(stateUpdateProfilePath());
  const presetRef = isRecord(profile?.presetRef) ? profile.presetRef : undefined;
  return Boolean(stringValue(presetRef?.presetId) && stringValue(presetRef?.presetVersionId));
});
const stateHistoryTurnsValue = computed(() => {
  if (!selectedStateHistoryTurns.value.trim()) return undefined;
  const value = Number(selectedStateHistoryTurns.value);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
});
const stateHistoryTurnsInvalid = computed(() =>
  Boolean(selectedStateHistoryTurns.value.trim()) && stateHistoryTurnsValue.value === undefined,
);
const previewTabs: Array<{ id: PreviewTab; label: string }> = [
  { id: "page", label: "previewPage" },
  { id: "prompt", label: "previewPrompt" },
  { id: "state-prompt", label: "previewStatePrompt" },
  { id: "variables", label: "previewVariables" },
  { id: "trial", label: "previewTrial" },
];
const displayName = computed(() => stringValue(parseFile("character.json")?.name) || selectedCard.value?.name || labels.pageTitle);
const revisionLabel = computed(() => selectedCard.value ? `角色卡 #${selectedCard.value.id} · 修订 ${selectedCard.value.revision}` : "");
const revisionNumberLabel = computed(() => selectedCard.value ? `修订 ${selectedCard.value.revision}` : "");
const filePaths = computed(() => {
  const paths = new Set(selectedCard.value?.files.map((file) => file.path) ?? []);
  for (const move of editor.movedFiles.value) {
    paths.delete(move.from);
    paths.add(move.to);
  }
  for (const path of editor.deletedFiles.value) paths.delete(path);
  for (const path of Object.keys(fileContents.value)) paths.add(path);
  return [...paths].sort((a, b) => a.localeCompare(b));
});
const filteredChapters = computed(() =>
  config.chapters.filter((chapter) => {
    const text = `${label(chapter.labelKey)} ${chapter.defaultPath}`.toLocaleLowerCase();
    return text.includes(search.value.toLocaleLowerCase());
  }),
);
const fileGroups = computed(() => {
  const rootGroup = config.fileTreeGroups.find((group) => !group.pathPrefix)?.key ?? "根目录";
  const groups = new Map<string, string[]>(config.fileTreeGroups
    .filter((group) => group.pathPrefix)
    .map((group) => [group.key, []]));
  const dynamicGroups: string[] = [];
  for (const path of filePaths.value.filter((item) => item.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
    const configured = config.fileTreeGroups
      .filter((group) => group.pathPrefix)
      .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length)
      .find((group) => path.startsWith(group.pathPrefix));
    const group = configured?.key ?? (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : rootGroup);
    if (!groups.has(group) && group !== rootGroup) {
      groups.set(group, []);
      dynamicGroups.push(group);
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(path);
  }
  return [
    ...[...groups.entries()].filter(([group]) => group !== rootGroup && !dynamicGroups.includes(group)),
    ...dynamicGroups.map((group) => [group, groups.get(group)!] as [string, string[]]),
    [rootGroup, groups.get(rootGroup) ?? []] as [string, string[]],
  ];
});
const currentPath = computed(() => {
  if (editorMode.value === "source") return activeFile.value;
  if (activeDomain.value === "worldbooks") return selectedEntry.value || bookFilePath(selectedBook.value) || "";
  if (activeDomain.value === "openings") {
    const openingFile = openingString("textFile");
    return filePaths.value.includes(openingFile) ? openingFile : domainFiles("openings")[0] ?? "";
  }
  const chapterPath = config.chapters.find((chapter) => chapter.key === activeDomain.value)?.defaultPath;
  if (chapterPath && filePaths.value.includes(chapterPath)) return chapterPath;
  return domainFiles(activeDomain.value)[0] ?? "";
});
const currentFile = computed(() => fileContents.value[currentPath.value]);
const currentFileIsBinary = computed(() => currentFile.value?.encoding === "base64");
const packageCount = computed(() => filePaths.value.length);
const savedState = computed(() => {
  if (saving.value) return labels.saving;
  if (dirty.value) return labels.unsaved;
  return selectedCard.value ? `${labels.savedAt}${new Date(selectedCard.value.updatedAt).toLocaleTimeString()}` : labels.notSavedYet;
});
const editorSavedState = computed(() => {
  if (saving.value) return labels.saving;
  if (dirty.value) return labels.unsaved;
  return selectedCard.value ? `${labels.footerSavedAt}${new Date(selectedCard.value.updatedAt).toLocaleString()}` : labels.notSavedYet;
});
const saveActionLabel = computed(() => saveAndContinueLabel(pendingAction.value, labels as Parameters<typeof saveAndContinueLabel>[1]));
const failureMessage = computed(() => humanError(failure.value));
const failureIssues = computed(() => nativeCardIssuesFromError(failure.value));
const currentJsonError = computed(() => {
  const path = currentPath.value;
  if (!path.endsWith(".json") || !currentFile.value || currentFile.value.encoding !== "utf8") return "";
  try {
    JSON.parse(currentFile.value.content);
    return "";
  } catch (error) {
    return formatJsonSyntaxError(currentFile.value.content, error);
  }
});
const selectedOpeningRecord = computed(() => {
  const item = jsonArray("openings.json", "items").find((opening) => stringValue(opening.id) === selectedOpening.value);
  return item ?? jsonArray("openings.json", "items")[0];
});
const selectedBookRecord = computed(() => {
  return characterBooks().find((book) => stringValue(book.id) === selectedBook.value) ?? characterBooks()[0];
});
const selectedEntryRecord = computed(() => parseFile(selectedEntry.value));
const selectedBookDocument = computed(() => parseFile(bookFilePath(selectedBook.value)));
const openingText = computed(() => stringValue(selectedOpeningRecord.value?.textFile));
const openingInitialState = computed(() => stringValue(selectedOpeningRecord.value?.initialStateFile));
const systemConfiguration = computed<NativeCardSystemConfiguration | undefined>(() => {
  if (stateHistoryTurnsInvalid.value) return undefined;
  if (selectedStatePreset.value && !selectedStatePresetVersion.value) return undefined;
  if (stateUpdateRequired.value && !selectedStatePreset.value && !stateProfileHasDefaultPreset.value) return undefined;
  return buildNativeCardSystemConfiguration({
    presetId: selectedPreset.value,
    presetVersionId: selectedPresetVersion.value,
    defaultUserId: selectedUser.value,
    promptMode: selectedPromptMode.value,
    narratorProfileId: selectedNarratorModel.value,
    stateUpdateRequired: stateUpdateRequired.value,
    stateUpdaterProfileId: selectedStateUpdaterModel.value,
    statePresetId: selectedStatePreset.value || undefined,
    statePresetVersionId: selectedStatePresetVersion.value || undefined,
    stateHistoryTurns: stateHistoryTurnsValue.value,
  });
});
const systemConfigurationHint = computed(() => {
  if (!selectedPreset.value || !selectedPresetVersion.value || !selectedUser.value) return labels.requiredSystemConfiguration;
  if (!selectedNarratorModel.value) return labels.chooseNarratorModel;
  if (stateUpdateRequired.value && !selectedStateUpdaterModel.value) return labels.chooseStateUpdaterModel;
  if (stateUpdateRequired.value && !selectedStatePreset.value && !stateProfileHasDefaultPreset.value) return labels.chooseStatePreset;
  if (selectedStatePreset.value && !selectedStatePresetVersion.value) return labels.chooseStatePresetVersion;
  if (stateHistoryTurnsInvalid.value) return labels.invalidStateHistoryTurns;
  return "";
});
const conflictPaths = computed(() => Object.keys(editor.originalContents.value).filter((path) => {
  const before = editor.originalContents.value[path];
  const after = fileContents.value[path];
  return !!before && !!after && before.content !== after.content;
}));

function label(key: string): string {
  return (labels as unknown as Record<string, string>)[key] ?? key;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function setSelectedEntryFocusTarget(path: string, element: Element | null): void {
  if (path === selectedEntry.value) selectedEntryFocusTarget.value = element as HTMLButtonElement | undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseFile(path: string): JsonObject | null {
  const text = fileContents.value[path]?.content;
  if (!text || fileContents.value[path]?.encoding !== "utf8") return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseJson(path: string): unknown {
  const file = fileContents.value[path];
  if (!file || file.encoding !== "utf8") return undefined;
  try { return JSON.parse(file.content) as unknown; } catch { return undefined; }
}

function valueAt(path: string, propertyPath: string): unknown {
  let value: unknown = parseJson(path);
  if (!propertyPath) return value;
  for (const key of propertyPath.split(".")) {
    if (Array.isArray(value)) value = value[Number(key)];
    else if (isRecord(value)) value = value[key];
    else return undefined;
  }
  return value;
}

function jsonArray(path: string, key: string): JsonObject[] {
  const value = parseFile(path)?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(path: string, key: string): string[] {
  const value = parseFile(path)?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function characterBooks(): JsonObject[] {
  return jsonArray("character.json", "worldbooks");
}

function bookFilePath(bookId: string): string {
  const record = characterBooks().find((book) => stringValue(book.id) === bookId);
  return stringValue(record?.file);
}

function openingString(field: string): string {
  const opening = selectedOpeningRecord.value;
  return stringValue(opening?.[field]);
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function humanError(error: unknown): string {
  return error ? nativeCardHumanError(error, labels.errorTitle) : "";
}

function systemRuntimeSummary(slot: string): string {
  const runtime = runtimeModelOptions.value.find((item) => item.slot === slot);
  if (!runtime) return labels.noSystemDefault;
  const source = runtime.source === "global_profile"
    ? labels.globalProfileSource
    : runtime.source === "session_profile"
      ? labels.sessionProfileSource
      : labels.environmentModelSource;
  return `${source} · ${runtime.provider} · ${runtime.modelId}`;
}

function notify(message: string): void {
  toastMessage.value = message;
  if (toastTimer.value) clearTimeout(toastTimer.value);
  toastTimer.value = setTimeout(() => (toastMessage.value = ""), 3200);
}

function openDialog(kind: DialogKind, preserveFocusReturn = false): void {
  operationFailure.value = "";
  preserveFocusReturn = preserveFocusReturn || preserveDialogFocusForNextOpen;
  preserveDialogFocusForNextOpen = false;
  if (!dialog.value?.open) {
    const active = document.activeElement;
    const activeOutsideClosedDialog = active instanceof HTMLElement && active !== document.body && !dialog.value?.contains(active);
    if (!preserveFocusReturn) {
      dialogFocusReturn.reset();
      if (activeOutsideClosedDialog) dialogFocusReturn.capture(active);
    }
  }
  activeDialog.value = kind;
  void nextTick(() => {
    if (!dialog.value) return;
    if (!dialog.value.open) dialog.value.showModal();
    focusDialogEntry(dialog.value);
  });
}

function closeDialog(): void {
  preserveDialogFocusForNextOpen = false;
  if (activeDialog.value === "settings" && systemAction.value === "preview") requestedPreviewTab.value = undefined;
  if (activeDialog.value === "preview") {
    const stablePreviewAction = document.querySelector<HTMLElement>(".workspacebar [data-action='preview']");
    if (stablePreviewAction) {
      dialogFocusReturn.reset();
      dialogFocusReturn.capture(stablePreviewAction);
    }
  }
  closeDialogInternal(false);
}

let preserveDialogFocusForNextOpen = false;

function closeDialogForTransition(): void {
  preserveDialogFocusForNextOpen = true;
  closeDialogInternal(true);
}

function closeDialogForNavigation(): void {
  preserveDialogFocusForNextOpen = false;
  closeDialogInternal(true);
  dialogFocusReturn.reset();
}

function closeDialogInternal(preserveFocus: boolean): void {
  const hadDialog = Boolean(dialog.value?.open || activeDialog.value);
  if (activeDialog.value === "import") {
    resetImportRequest();
    importFailure.value = "";
    editor.failure.value = undefined;
  }
  activeDialog.value = undefined;
  if (dialog.value?.open) dialog.value.close();
  if (!preserveFocus && hadDialog) restoreDialogFocusWhenClosed();
}

function restoreDialogFocusWhenClosed(): void {
  preserveDialogFocusForNextOpen = false;
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      if (dialog.value?.open || activeDialog.value) return;
      dialogFocusReturn.restore();
    });
  });
}

async function readPaths(paths: Array<string | undefined>): Promise<void> {
  const card = selectedCard.value;
  if (!card) return;
  const savedPaths = card.files.map((file) => file.path);
  const workspacePaths = Object.keys(fileContents.value);
  const movedFromPaths = editor.movedFiles.value.map((move) => move.from);
  const deletedPaths = editor.deletedFiles.value;
  const readablePaths = [...new Set(paths.filter((path): path is string => !!path))]
    .filter((path) => isPackageFileReadable(path, savedPaths, workspacePaths, movedFromPaths, deletedPaths));
  await Promise.all(readablePaths.map((path) => editor.openFile(path)));
}

async function loadDomainFiles(domain: string): Promise<void> {
  await readPaths(["character.json", "openings.json", "manifest.json"]);
  if (domain === "worldbooks") {
    const books = characterBooks();
    await readPaths(books.map((book) => stringValue(book.file)));
    const selected = books.find((book) => stringValue(book.id) === selectedBook.value) ?? books[0];
    if (selected) {
      selectedBook.value = stringValue(selected.id);
      const entries = stringArray(stringValue(selected.file), "entryFiles");
      await readPaths(entries);
      selectedEntry.value = entries.includes(selectedEntry.value) ? selectedEntry.value : entries[0] ?? "";
    }
  } else if (domain === "openings") {
    const openings = jsonArray("openings.json", "items");
    const selected = openings.find((item) => stringValue(item.id) === selectedOpening.value) ?? openings[0];
    if (selected) selectedOpening.value = stringValue(selected.id);
    await readPaths(openings.flatMap((item) => [stringValue(item.textFile), stringValue(item.initialStateFile)]));
  } else if (domain === "variables") {
    await readPaths(["state/schema.json", stringValue(parseFile("character.json")?.stateUpdate)]);
    const profile = parseFile(stringValue(parseFile("character.json")?.stateUpdate));
    await readPaths([stringValue(profile?.stateSchemaFile)]);
  } else if (domain === "agent") {
    const profilePath = stringValue(parseFile("character.json")?.stateUpdate);
    await readPaths([profilePath]);
    const profile = parseFile(profilePath);
    await readPaths([...(Array.isArray(profile?.ruleFiles) ? profile.ruleFiles.filter((item): item is string => typeof item === "string") : []), stringValue(profile?.deriveScript), stringValue(profile?.validateScript)]);
  } else if (domain === "controller") {
    await readPaths(["backend/controllers/config.json"]);
    const controller = parseFile("backend/controllers/config.json");
    await readPaths([stringValue(controller?.modulePath)]);
  } else if (domain === "regex") {
    await readPaths(["regex/default.json", ...stringArray("character.json", "regexProfiles")]);
  } else if (domain === "frontend") {
    await readPaths(["frontend/manifest.json"]);
    const frontend = parseFile("frontend/manifest.json");
    await readPaths([stringValue(frontend?.html), stringValue(frontend?.css), stringValue(frontend?.script), openingText.value]);
  } else if (domain === "assets") {
    await readPaths(filePaths.value.filter((path) => path.startsWith("assets/") || path.startsWith("data/")));
  }
}

function domainFiles(domain: string): string[] {
  if (domain === "package") return [];
  const matching = filePaths.value.filter((path) => isDomainFile(path, domain));
  if (domain === "assets") return matching;
  return orderDomainFiles(domain, matching, nativeCardFileRules.creationTemplates);
}

async function loadEditor(cardId: string): Promise<void> {
  await editor.openCard(cardId);
  if (!editor.selectedCard.value) return;
  history.replaceState(null, "", `${config.path}?id=${encodeURIComponent(cardId)}`);
  activeDomain.value = "character";
  navigation.value = "domain";
  editorMode.value = "form";
  await loadDomainFiles("character");
}

async function openCatalog(): Promise<void> {
  if (dirty.value) {
    pendingLeaveAction.value = () => {
      editor.returnToCatalog();
      history.replaceState(null, "", config.path);
      activeDialog.value = undefined;
      void editor.loadCatalog();
    };
    openDialog("leave");
    return;
  }
  editor.returnToCatalog();
  history.replaceState(null, "", config.path);
  activeDialog.value = undefined;
  await editor.loadCatalog();
}

async function openDomain(key: string): Promise<void> {
  activeDomain.value = key;
  editorMode.value = "form";
  navigation.value = "domain";
  sidebarOpen.value = false;
  const chapter = config.chapters.find((item) => item.key === key);
  activeFile.value = chapter?.defaultPath ?? "character.json";
  if (key === "worldbooks" && !selectedBook.value) selectedBook.value = stringValue(characterBooks()[0]?.id);
  if (key === "openings" && !selectedOpening.value) selectedOpening.value = stringValue(jsonArray("openings.json", "items")[0]?.id);
  await loadDomainFiles(key);
  if (key === "worldbooks") activeFile.value = bookFilePath(selectedBook.value) || "character.json";
  if (key === "openings") activeFile.value = openingText.value || "openings.json";
  if (key === "assets") activeFile.value = filePaths.value.find((path) => path.startsWith("assets/")) ?? "assets/";
  await nextTick();
  if (editorScroll.value) editorScroll.value.scrollTop = 0;
}

async function openFile(path: string): Promise<void> {
  if (dialog.value?.open) closeDialog();
  activeFile.value = path;
  editorMode.value = "source";
  navigation.value = "files";
  sidebarOpen.value = false;
  await editor.openFile(path);
  domainForFile(path);
  await nextTick();
  editorScroll.value?.scrollTo({ top: 0 });
}

function domainForFile(path: string): void {
  if (path === "character.json") activeDomain.value = "character";
  else if (path.startsWith("worldbooks/")) activeDomain.value = "worldbooks";
  else if (path === "openings.json" || path.startsWith("openings/")) activeDomain.value = "openings";
  else if (path.startsWith("state/")) activeDomain.value = "variables";
  else if (path.startsWith("agents/")) activeDomain.value = "agent";
  else if (path.startsWith("backend/controllers/")) activeDomain.value = "controller";
  else if (path.startsWith("regex/")) activeDomain.value = "regex";
  else if (path.startsWith("frontend/")) activeDomain.value = "frontend";
  else if (path.startsWith("assets/") || path.startsWith("data/")) activeDomain.value = "assets";
  else if (path === "manifest.json") activeDomain.value = "package";
}

function setJsonFile(path: string, object: JsonObject): void {
  editor.writeFile(path, pretty(object));
}

function updateJson(path: string, propertyPath: string, value: unknown): void {
  const parsed = parseJson(path);
  if (!isRecord(parsed)) return;
  const keys = propertyPath.split(".");
  let target: unknown = parsed;
  for (const key of keys.slice(0, -1)) {
    if (Array.isArray(target)) target = target[Number(key)];
    else if (isRecord(target)) target = target[key];
    else return;
  }
  const finalKey = keys.at(-1);
  if (Array.isArray(target)) target[Number(finalKey)] = value;
  else if (isRecord(target) && finalKey) target[finalKey] = value;
  else return;
  setJsonFile(path, parsed);
}

function updateList(path: string, property: string, values: string[]): void {
  updateJson(path, property, values);
}

function handleInput(event: Event, path: string, property: string, type: "text" | "number" = "text"): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
  updateJson(path, property, type === "number" ? Number(target.value) : target.value);
}

function handleCheckbox(event: Event, path: string, property: string, array = false, invert = false): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const checked = invert ? !event.target.checked : event.target.checked;
  if (array) {
    const rows = arrayFile(path);
    const [indexText, ...rest] = property.split(".");
    const row = rows[Number(indexText)];
    if (row && rest.length) {
      row[rest.join(".")] = checked;
      editor.writeFile(path, pretty(rows));
    }
  } else updateJson(path, property, checked);
}

function updateCurrentFile(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) editor.writeFile(activeFile.value, event.target.value);
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const size = 0x8000;
  for (let start = 0; start < bytes.length; start += size) {
    binary += String.fromCharCode(...bytes.subarray(start, start + size));
  }
  return btoa(binary);
}

function filePurpose(path: string): string {
  const source = selectedCard.value?.files.find((file) => file.path === path)?.purpose;
  if (source) return source;
  const rule = getNativeCardPackageFileRule(path);
  if (rule) return rule.purpose;
  return path.startsWith("assets/") ? "media" : "data";
}

function fileMediaType(path: string, fallback = "application/octet-stream"): string {
  const local = fileContents.value[path]?.mediaType;
  if (local) return local;
  const existing = selectedCard.value?.files.find((file) => file.path === path)?.mediaType;
  if (existing) return existing;
  const rule = getNativeCardPackageFileRule(path);
  if (rule) return rule.mediaTypes.find((type) => type !== "*/*") ?? fallback;
  return fallback;
}

async function syncManifest(): Promise<void> {
  const manifest = parseFile("manifest.json");
  if (!manifest) return;
  const records = filePaths.value.filter((path) => path !== "manifest.json").flatMap((path) => {
    const rule = getNativeCardPackageFileRule(path);
    if (!rule || rule.inManifestFiles === false) return [];
    return [{ path, mediaType: fileMediaType(path), purpose: filePurpose(path) }];
  });
  manifest.files = records.sort((a, b) => a.path.localeCompare(b.path));
  setJsonFile("manifest.json", manifest);
}

function openCreateDialog(): void {
  newCardName.value = "";
  operationFailure.value = "";
  openDialog("create");
}

async function createCard(): Promise<void> {
  const name = newCardName.value.trim();
  if (!name) {
    operationFailure.value = "请填写角色卡名称。";
    return;
  }
  operationFailure.value = "";
  const created = await editor.createCard(name);
  if (!created) {
    operationFailure.value = humanError(failure.value);
    return;
  }
  closeDialog();
  history.replaceState(null, "", `${config.path}?id=${encodeURIComponent(created.id)}`);
  await loadDomainFiles("character");
    notify(label("createCard"));
}

function beginImport(): void {
  if (dirty.value) {
    pendingLeaveAction.value = () => {
      editor.returnToCatalog();
      void beginImportNow();
    };
    openDialog("leave");
    return;
  }
  void beginImportNow();
}

let importDialogGeneration = 0;

function resetImportRequest(): void {
  importDialogGeneration += 1;
  editor.resetImport();
}

async function beginImportNow(): Promise<void> {
  resetImportRequest();
  importFile.value = undefined;
  importFailure.value = "";
  importStage.value = "select";
  importedCard.value = undefined;
  editor.importPreview.value = null;
  editor.failure.value = undefined;
  openDialog("import");
}

function chooseImportFile(): void {
  if (importInput.value) {
    importInput.value.value = "";
    importInput.value.click();
  }
}

function returnToImportSelection(): void {
  resetImportRequest();
  importStage.value = "select";
  importFailure.value = "";
  editor.importPreview.value = null;
}

function importResourceSummary(): Array<{ name: string; result: string }> {
  const summary = importPreview.value?.summary;
  if (!summary) return [];
  const joinParts = (items: string[]): string => {
    if (!items.length) return labels.importAbsent;
    if (items.length === 1) return items[0]!;
    return items.slice(0, -1).join(labels.importListSeparator) + labels.importListLastSeparator + items.at(-1);
  };
  return [
    { name: labels.importCharacter, result: labels.importCharacterResult },
    { name: labels.importWorldbooks, result: summary.worldbookCount ? labels.importWorldbookResult.replace("{count}", String(summary.worldbookCount)) : labels.importAbsent },
    { name: labels.importOpenings, result: summary.openingCount === 0 ? labels.importAbsent : (summary.openingCount === summary.initialStateCount ? labels.importOpeningResult : labels.importOpeningPartialResult).replace("{count}", String(summary.openingCount)).replace("{states}", String(summary.initialStateCount)) },
    { name: labels.importStateUpdater, result: joinParts([
      ...(summary.stateUpdate.rules ? [labels.importRules] : []), ...(summary.stateUpdate.schema ? [labels.importStateSchema] : []),
      ...(summary.stateUpdate.validators ? [labels.importValidators] : []), ...(summary.stateUpdate.tools ? [labels.importTools] : []),
    ]) },
    { name: labels.importController, result: summary.promptController ? labels.importControllerResult : labels.importAbsent },
    { name: labels.importFrontend, result: joinParts([
      ...(summary.frontend.page ? [labels.importPage] : []), ...(summary.frontend.script ? [labels.importScript] : []),
      ...(summary.frontend.style ? [labels.importStyle] : []), ...(summary.frontend.media ? [labels.importMedia] : []),
    ]) },
    { name: labels.importRegex, result: summary.regexProfileCount ? labels.importRegexResult : labels.importAbsent },
  ];
}

function selectImportFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  resetImportRequest();
  importFile.value = file;
  importFailure.value = "";
  editor.importPreview.value = null;
  editor.failure.value = undefined;
  importStage.value = /\.zip$/i.test(file.name) ? "select" : "invalid";
  if (importStage.value === "invalid") importFailure.value = label("importZipRequired");
}

async function checkImport(): Promise<void> {
  if (!importFile.value) return;
  if (!/\.zip$/i.test(importFile.value.name)) {
    importStage.value = "invalid";
    importFailure.value = label("importZipRequired");
    return;
  }
  importStage.value = "checking";
  importFailure.value = "";
  editor.failure.value = undefined;
  await nextTick();
  dialogCloseButton.value?.focus({ preventScroll: true });
  if (!await editor.checkImport(importFile.value, importFile.value.name)) return;
  if (failure.value) {
    importStage.value = "invalid";
    importFailure.value = humanError(failure.value);
  } else if (importPreview.value?.status === "ready") {
    importStage.value = "ready";
  } else {
    importStage.value = "invalid";
    importFailure.value = label("importInvalid");
  }
  editor.failure.value = undefined;
  await nextTick();
  if (!dialog.value?.open || activeDialog.value !== "import") return;
  (importStage.value === "ready" ? importConfirmButton.value : importRecheckButton.value ?? dialogCloseButton.value)
    ?.focus({ preventScroll: true });
}

async function confirmImport(): Promise<void> {
  if (!importPreview.value || !["ready", "commit-failed"].includes(importStage.value)) return;
  importStage.value = "importing";
  importFailure.value = "";
  editor.failure.value = undefined;
  await nextTick();
  dialogCloseButton.value?.focus({ preventScroll: true });
  const generation = importDialogGeneration;
  const imported = await editor.confirmImport();
  if (generation !== importDialogGeneration) return;
  if (!imported) {
    const error = failure.value;
    importStage.value = error && typeof error === "object" && "code" in error
      && error.code === "NATIVE_CARD_IMPORT_NOT_FOUND" ? "expired" : "commit-failed";
    importFailure.value = humanError(error);
    editor.failure.value = undefined;
    await nextTick();
    if (dialog.value?.open && activeDialog.value === "import") {
      (importStage.value === "expired" ? importRecheckButton.value : importRetryConfirmButton.value)
        ?.focus({ preventScroll: true });
    }
    return;
  }
  importedCard.value = imported;
  importStage.value = "complete";
  editor.failure.value = undefined;
  await nextTick();
  if (dialog.value?.open && activeDialog.value === "import") {
    importOpenCardButton.value?.focus({ preventScroll: true });
  }
}

async function openImportedCard(): Promise<void> {
  const imported = importedCard.value;
  if (!imported) return;
  closeDialog();
  history.replaceState(null, "", `${config.path}?id=${encodeURIComponent(imported.id)}`);
  activeDomain.value = "character";
  editorMode.value = "form";
  navigation.value = "domain";
  await loadDomainFiles("character");
  notify(label("importSuccess"));
}

async function save(): Promise<boolean> {
  const saved = await editor.save();
  if (editor.conflict.value) {
    selectedConflictPath.value = conflictPaths.value[0] ?? activeFile.value;
    if (selectedConflictPath.value) await editor.readConflictFile(selectedConflictPath.value);
    openDialog("conflict", true);
    return false;
  }
  if (!saved) return false;
  notify(label("saveResult"));
  return true;
}

async function saveUntilClean(): Promise<boolean> {
  while (dirty.value) {
    if (!await save()) return false;
  }
  return true;
}

async function selectConflictPath(path: string): Promise<void> {
  selectedConflictPath.value = path;
  await editor.readConflictFile(path);
}

function requestSave(): void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (trigger && trigger !== document.body) {
    dialogFocusReturn.reset();
    dialogFocusReturn.capture(trigger);
  }
  void save().then(async () => {
    await nextTick();
    if (dialog.value?.open) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreAsyncActionFocus(trigger, active, document.body);
  });
}

function requireSaved(action: EditorAction): void {
  if (action === "build") {
    openBuildDialog();
    return;
  }
  if (!dirty.value) {
    void performAction(action);
    return;
  }
  pendingAction.value = action;
  openDialog("before-action");
}

async function saveAndContinue(): Promise<void> {
  const action = pendingAction.value;
  pendingAction.value = undefined;
  closeDialogForTransition();
  if (action) await saveThenRunAction(action, saveUntilClean, (requested) => performAction(requested, true));
  else await saveUntilClean();
  restoreDialogFocusWhenClosed();
}

async function performAction(action: EditorAction, preserveFocusReturn = false): Promise<void> {
  const active = document.activeElement;
  if (!preserveFocusReturn && active instanceof HTMLElement && active !== document.body && !dialog.value?.contains(active)) {
    dialogFocusReturn.reset();
    dialogFocusReturn.capture(active);
  } else if (active instanceof HTMLElement && active !== document.body && !dialog.value?.contains(active) && !dialogFocusReturn.hasTarget) {
    dialogFocusReturn.capture(active);
  }
  if (action === "check") {
    const result = await editor.validate();
    openDialog("check", true);
    if (!result) operationFailure.value = humanError(failure.value);
    return;
  }
  if (action === "preview" || action === "publish") {
    if (action === "publish") {
      const result = await editor.validate();
      if (!result?.valid) {
        openDialog("check", true);
        return;
      }
    }
    systemAction.value = action;
    publicationNote.value = "";
    selectedSessionType.value = "individual";
    openDialog("settings", true);
    await loadSystemOptions();
    return;
  }
  if (action === "build") {
    openBuildDialog(true);
  }
}

function openBuildDialog(preserveFocusReturn = false): void {
  buildEntryRevision.value = selectedCard.value?.revision ?? 1;
  buildEntrySummary.value = selectedCard.value ? buildSummaryForCard(selectedCard.value) : undefined;
  buildSource.value = { revision: buildEntryRevision.value };
  buildTaskSummary.value = undefined;
  buildTaskFromSaved.value = false;
  openDialog("build", preserveFocusReturn);
}

function buildSummaryForCard(card: NativeCard): BuildSourceSummary {
  return { revision: card.revision, name: card.name, fileCount: card.files.length };
}

function buildSummaryForSource(source: NativeCardBuildSource): BuildSourceSummary {
  if ("revision" in source) {
    if (buildEntrySummary.value?.revision === source.revision) return { ...buildEntrySummary.value };
    if (selectedCard.value?.revision === source.revision) return buildSummaryForCard(selectedCard.value);
    return { revision: source.revision };
  }
  const version = selectedCard.value?.versions.find((item) => item.id === source.versionId);
  return { revision: version?.revision ?? build.value?.revision ?? buildEntryRevision.value, versionId: source.versionId };
}

function buildSourceOption(): string {
  if ("versionId" in buildSource.value) return buildSource.value.versionId;
  return buildSource.value.revision === buildEntryRevision.value ? "current" : "latest-saved";
}

async function locateIssue(issue: NativeCardIssue): Promise<void> {
  closeDialogForNavigation();
  await openFile(issue.path);
  checkedIssue.value = issue;
  await nextTick();
  const source = sourceEditor.value;
  if (!source) {
    editorScroll.value?.focus();
    return;
  }
  if (issue.line) {
    const rows = source.value.split("\n");
    const lineIndex = Math.min(rows.length - 1, Math.max(0, issue.line - 1));
    const offset = rows.slice(0, lineIndex).reduce((sum, row) => sum + row.length + 1, 0) + Math.min(rows[lineIndex]?.length ?? 0, Math.max(0, (issue.column ?? 1) - 1));
    source.setSelectionRange(Math.min(source.value.length, offset), Math.min(source.value.length, offset));
  }
  source.focus();
}

async function resolveConflict(useServer: boolean): Promise<void> {
  const path = selectedConflictPath.value;
  if (useServer && path) await editor.useServerFile(path);
  if (!await editor.acceptServerRevision()) {
    operationFailure.value = humanError(failure.value);
    return;
  }
  closeDialog();
  if (!useServer && path) notify(labels.keepLocal);
}

async function loadSystemOptions(): Promise<void> {
  systemBusy.value = true;
  operationFailure.value = "";
  try {
    const configResponse = await fetch(`/config/${publicConfigurationFiles.roleAdminWeb.filename}`);
    if (!configResponse.ok) throw new Error(String(apiErrorMessages.ROLE_APP_CONFIG_INVALID));
    const parsedConfig = roleAdminWebConfigSchema.safeParse(await configResponse.json());
    if (!parsedConfig.success) throw new Error(String(apiErrorMessages.ROLE_APP_CONFIG_INVALID));
    userWebBaseUrl.value = parsedConfig.data.userWebBaseUrl;
    [presetOptions.value, userOptions.value, modelOptions.value, runtimeModelOptions.value] = await Promise.all([
      apiClient.presets.list(),
      apiClient.users.list(),
      apiClient.llmProfiles.list(),
      apiClient.llmProfiles.runtime(),
    ]);
    selectedPreset.value = presetOptions.value[0]?.id ?? "";
    selectedStatePreset.value = "";
    selectedStatePresetVersion.value = "";
    selectedStateHistoryTurns.value = "";
    statePresetVersionOptions.value = [];
    selectedUser.value = userOptions.value.find((item) => item.status === "active")?.id ?? "";
    selectedNarratorModel.value = "";
    selectedStateUpdaterModel.value = "";
    await loadPresetVersions();
  } catch (error) {
    operationFailure.value = humanError(error);
  } finally {
    systemBusy.value = false;
  }
}

async function loadPresetVersions(): Promise<void> {
  selectedPresetVersion.value = "";
  if (!selectedPreset.value) {
    presetVersionOptions.value = [];
    return;
  }
  try {
    const versions = await apiClient.presets.listVersions({ presetId: selectedPreset.value });
    presetVersionOptions.value = versions
      .map((item) => ({ id: item.id, versionNo: item.versionNo }))
      .sort((a, b) => b.versionNo - a.versionNo);
    selectedPresetVersion.value = presetVersionOptions.value[0]?.id ?? "";
  } catch (error) {
    operationFailure.value = humanError(error);
  }
}

async function loadStatePresetVersions(): Promise<void> {
  selectedStatePresetVersion.value = "";
  if (!selectedStatePreset.value) {
    statePresetVersionOptions.value = [];
    return;
  }
  try {
    const versions = await apiClient.presets.listVersions({ presetId: selectedStatePreset.value });
    statePresetVersionOptions.value = versions
      .map((item) => ({ id: item.id, versionNo: item.versionNo }))
      .sort((a, b) => b.versionNo - a.versionNo);
    selectedStatePresetVersion.value = statePresetVersionOptions.value[0]?.id ?? "";
  } catch (error) {
    operationFailure.value = humanError(error);
  }
}

async function runSystemAction(): Promise<void> {
  const configuration = systemConfiguration.value;
  if (!configuration) {
    operationFailure.value = systemConfigurationHint.value || labels.requiredSystemConfiguration;
    return;
  }
  systemBusy.value = true;
  operationFailure.value = "";
  if (systemAction.value === "preview") {
    const openingId = stringValue(selectedOpeningRecord.value?.id);
    const result = await editor.createPreview(configuration, openingId || undefined, selectedUser.value, selectedSessionType.value);
    if (!result) {
      operationFailure.value = humanError(failure.value);
      systemBusy.value = false;
      await nextTick();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreAsyncActionFocus(systemActionButton.value ?? null, active, document.body);
      return;
    }
    previewSessionId.value = result.sessionId;
    const url = new URL(userWebBaseUrl.value);
    url.searchParams.set("sessionId", result.sessionId);
    for (const key of ["floorId", "branchId", "runId", "pageId", "callId"]) url.searchParams.delete(key);
    previewSessionUrl.value = url.href;
    previewTab.value = requestedPreviewTab.value ?? "page";
    requestedPreviewTab.value = undefined;
    dryRunResult.value = undefined;
    stateDryRunResult.value = undefined;
    stateDryRunFloorId.value = "";
    roleView.value = undefined;
    proposalInspection.value = undefined;
    trialTurns.value = [];
    closeDialogForTransition();
    openDialog("preview");
    await loadRoleView();
  } else {
    const result = await editor.publish(configuration, publicationNote.value);
    if (!result) {
      operationFailure.value = humanError(failure.value);
      systemBusy.value = false;
      await nextTick();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restoreAsyncActionFocus(systemActionButton.value ?? null, active, document.body);
      return;
    }
    closeDialogForTransition();
    openDialog("publication");
  }
  systemBusy.value = false;
}

async function loadRoleView(): Promise<void> {
  if (!previewSessionId.value) return;
  previewLoading.value = true;
  previewFailure.value = "";
  try {
    roleView.value = await apiClient.roleRuntime.getView({ sessionId: previewSessionId.value });
  } catch (error) {
    previewFailure.value = humanError(error);
  } finally {
    previewLoading.value = false;
  }
}

async function inspectStateProposal(): Promise<void> {
  const sessionId = previewSessionId.value;
  const trigger = proposalInspectButton.value ?? null;
  if (proposalInspectionBusy.value) return;
  proposalInspection.value = undefined;
  proposalInspectionFailure.value = "";
  if (!sessionId) {
    proposalInspectionFailure.value = labels.proposalInspectionNeedsPreview;
    return;
  }
  const parsed = parseProposalInspectionInput(sourceMessagesJson.value, proposalJson.value);
  if (!parsed.valid) {
    proposalInspectionFailure.value = parsed.reason === "invalid_json"
      ? labels.proposalInspectionInvalidJson
      : labels.proposalInspectionInvalidShape;
    return;
  }
  proposalInspectionBusy.value = true;
  try {
    proposalInspection.value = await apiClient.roleRuntime.inspectProposal({ sessionId, input: parsed.input });
  } catch (error) {
    proposalInspectionFailure.value = humanError(error);
  } finally {
    proposalInspectionBusy.value = false;
    await nextTick();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreAsyncActionFocus(trigger, active, document.body);
  }
}

function openProposalInspection(): void {
  proposalInspectionFailure.value = "";
  if (!previewSessionId.value) {
    requestedPreviewTab.value = "variables";
    requireSaved("preview");
    return;
  }
  previewTab.value = "variables";
  openDialog("preview");
  void loadRoleView();
}

async function runStatePromptDryRun(): Promise<void> {
  const sessionId = previewSessionId.value;
  if (!sessionId || previewLoading.value) return;
  previewLoading.value = true;
  previewFailure.value = "";
  stateDryRunResult.value = undefined;
  try {
    const view = await apiClient.roleRuntime.getView({sessionId});
    roleView.value = view;
    const floorId = stateDryRunFloorId.value.trim() || view.processing.pendingStateFloorId || view.current.floorId;
    if (!floorId) { previewFailure.value = labels.statePromptNeedsFloor; return; }
    stateDryRunResult.value = await apiClient.roleRuntime.previewStateUpdate({sessionId, floorId, expectedSnapshotId: view.current.snapshotId});
  } catch (error) { previewFailure.value = humanError(error); }
  finally { previewLoading.value = false; await restoreDialogActionFocus(stateDryRunButton.value ?? null); }
}

async function runPromptDryRun(): Promise<void> {
  if (!previewSessionId.value || !dryRunInput.value.trim()) return;
  previewLoading.value = true;
  previewFailure.value = "";
  try {
    dryRunResult.value = await apiClient.sessions.respondDryRun({
      sessionId: previewSessionId.value,
      message: dryRunInput.value,
      debugOptions: { includeWorldbookMatches: true },
    });
  } catch (error) {
    previewFailure.value = humanError(error);
  } finally {
    previewLoading.value = false;
    await restoreDialogActionFocus(dryRunButton.value ?? null);
  }
}

async function restoreDialogActionFocus(trigger: HTMLButtonElement | null): Promise<void> {
  await nextTick();
  if (!trigger || !dialog.value?.open || activeDialog.value !== "preview") return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  restoreAsyncActionFocus(trigger, active, document.body);
}

async function refreshRoleView(): Promise<void> {
  const trigger = variableRefreshButton.value ?? null;
  await loadRoleView();
  await restoreDialogActionFocus(trigger);
}

async function sendTrial(): Promise<void> {
  const sessionId = previewSessionId.value;
  const message = trialInput.value.trim();
  if (!sessionId || !message || trialSending.value) return;
  trialInput.value = "";
  trialFailure.value = "";
  trialTurns.value = [...trialTurns.value, { role: "user", content: message }, { role: "assistant", content: "" }];
  trialSending.value = true;
  try {
    await apiClient.sessions.respondStream({
      sessionId,
      message,
      onRoleText: ({ text }) => {
        const turns = [...trialTurns.value];
        const last = turns.at(-1);
        if (last?.role === "assistant") {
          last.content = text;
          trialTurns.value = turns;
        }
      },
    });
    await loadRoleView();
  } catch (error) {
    trialFailure.value = humanError(error);
  } finally {
    trialSending.value = false;
    await restoreDialogActionFocus(sendTrialButton.value ?? null);
  }
}

async function restartPreview(): Promise<void> {
  closeDialogForTransition();
  requestedPreviewTab.value = undefined;
  systemAction.value = "preview";
  openDialog("settings");
  await loadSystemOptions();
}

function openPreviewTab(tab: PreviewTab): void {
  previewTab.value = tab;
  if (tab === "variables" || tab === "state-prompt") void loadRoleView();
}

async function beginBuild(): Promise<void> {
  const source = buildSource.value;
  if (!selectedCard.value) return;
  pendingBuild.value = true;
  operationFailure.value = "";
  const requestedSummary = buildSummaryForSource(source);
  buildTaskSummary.value = requestedSummary;
  const created = await editor.createBuild(source);
  pendingBuild.value = false;
  if (!created) {
    operationFailure.value = humanError(failure.value);
    editor.failure.value = undefined;
    return;
  }
  const sourceMetadataMatches = requestedSummary.revision === created.revision
    && requestedSummary.versionId === created.versionId;
  buildTaskSummary.value = sourceMetadataMatches
    ? { ...requestedSummary, revision: created.revision }
    : {
        revision: created.revision,
        ...(created.versionId ? { versionId: created.versionId } : {}),
      };
  closeDialogForTransition();
  openDialog("build-task");
  startBuildPolling();
}

function startBuildPolling(): void {
  if (buildPoll.value) clearInterval(buildPoll.value);
  if (!build.value || ["succeeded", "failed"].includes(build.value.status)) return;
  buildPoll.value = setInterval(() => {
    void editor.refreshBuild(build.value?.id).then(() => {
      if (!build.value || ["succeeded", "failed"].includes(build.value.status)) {
        if (buildPoll.value) clearInterval(buildPoll.value);
        buildPoll.value = undefined;
      }
    });
  }, 1200);
}

function openBuildTask(): void {
  if (!build.value) return;
  if (!buildTaskSummary.value) {
    buildTaskSummary.value = {
      revision: build.value.revision,
      ...(build.value.versionId ? { versionId: build.value.versionId } : {}),
    };
  }
  openDialog("build-task");
}

async function retryBuild(): Promise<void> {
  operationFailure.value = "";
  buildTaskFailureAction.value = "retry";
  dialogCloseButton.value?.focus({ preventScroll: true });
  const retried = await editor.retryBuild();
  if (retried) startBuildPolling();
  else {
    operationFailure.value = humanError(failure.value);
    editor.failure.value = undefined;
  }
  await nextTick();
  if (dialog.value?.open && activeDialog.value === "build-task") {
    dialogCloseButton.value?.focus({ preventScroll: true });
  }
}

async function downloadBuild(): Promise<void> {
  operationFailure.value = "";
  buildTaskFailureAction.value = "download";
  const result = await editor.downloadBuild();
  if (!result || !build.value) {
    operationFailure.value = humanError(failure.value);
    editor.failure.value = undefined;
    return;
  }
  if (!result.fileName) {
    operationFailure.value = labels.downloadFilenameMissing;
    return;
  }
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildSourceLabel(): string {
  const source = buildSummaryForSource(buildSource.value);
  return `${label("buildSourceRevision")} ${source.revision}${source.versionId ? ` · ${source.versionId}` : ""}`;
}

function buildPhaseLabel(): string {
  const stage = build.value?.stage;
  if (stage === "validating") return label("taskChecking");
  if (stage === "archiving") return label("taskArchiving");
  return label("taskReady");
}

function buildIssueSummary(): string {
  return (build.value?.issues ?? [])
    .map((issue) => `${issue.path.trim() ? `${issue.path}：` : ""}${issue.message}`)
    .join("\n") || failureMessage.value;
}

function chooseBuildSource(value: string): void {
  if (value === "current") buildSource.value = { revision: buildEntryRevision.value };
  else if (value === "latest-saved") buildSource.value = { revision: selectedCard.value?.revision ?? buildEntryRevision.value };
  else buildSource.value = { versionId: value };
}

function beginUpload(path = ""): void {
  replaceTarget.value = path;
  if (uploadInput.value) {
    uploadInput.value.value = "";
    uploadInput.value.click();
  }
}

async function uploadFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  operationFailure.value = "";
  const replacingPath = replaceTarget.value;
  const path = replacingPath || `assets/${file.name}`;
  replaceTarget.value = "";
  const pathFailure = nativeCardPathFailure(path, labels.invalidPath, "media");
  if (pathFailure) {
    operationFailure.value = pathFailure;
    return;
  }
  if (replacingPath && !isNativeCardMediaReplacementCompatible(replacingPath, file.name)) {
    operationFailure.value = labels.replacementMediaFormatMismatch;
    return;
  }
  const mediaType = resolveNativeCardUploadMediaType(file.name, file.type);
  if (mediaType.status === "unsupported-extension") {
    operationFailure.value = labels.unsupportedMediaExtension.replace("{extensions}", mediaType.extensions.join("、"));
    return;
  }
  if (mediaType.status === "unsupported-media-type") {
    operationFailure.value = labels.unsupportedMediaType.replace("{extension}", mediaType.extension).replace("{mediaType}", mediaType.mediaType);
    return;
  }
  const content = toBase64(await file.arrayBuffer());
  try {
    if (filePaths.value.includes(path)) {
      const current = fileContents.value[path] ?? await editor.openFile(path);
      editor.writeFile(path, content, "base64", mediaType.mediaType);
      if (!current) throw new Error(`无法读取 ${path}。`);
    } else {
      editor.addFile({ path, mediaType: mediaType.mediaType, encoding: "base64", content });
    }
    await readPaths(["manifest.json"]);
    await syncManifest();
    notify(labels.uploadFile);
    await openDomain("assets");
  } catch (error) {
    operationFailure.value = humanError(error);
  }
}

function createFileDialog(): void {
  operationFailure.value = "";
  newFileRuleIndex.value = 0;
  const rule = allowedPackageFiles.value.directoryRules[0];
  newFilePath.value = rule?.pathPattern.replace("*", "new-file").replace(/\{[^{}]+\}/g, "new-book") ?? "data/new-file.json";
  openDialog("create-file");
}

function selectedCreateRule() {
  return allowedPackageFiles.value.directoryRules[newFileRuleIndex.value];
}

function creationTemplateForPath(path: string) {
  const exact = nativeCardFileRules.creationTemplates.find((template) => {
    const source = template.pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^{}]+\\\}/g, "[^/]+");
    return new RegExp(`^${source}$`).test(path);
  });
  if (exact) return exact;
  const rule = getNativeCardPackageFileRule(path);
  return rule?.creationTemplateId ? getNativeCardCreationTemplate(rule.creationTemplateId) : undefined;
}

function templateBindings(path: string, templatePath: string): Record<string, string> {
  const names = [...templatePath.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
  if (!names.length) return {};
  const source = templatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^{}]+\\\}/g, "([^/]+)");
  const match = new RegExp(`^${source}$`).exec(path);
  return match ? Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""])) : {};
}

function replaceTemplateBindings(value: unknown, bindings: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{([^{}]+)\}/g, (whole, key: string) => bindings[key] ?? whole);
  if (Array.isArray(value)) return value.map((item) => replaceTemplateBindings(item, bindings));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTemplateBindings(item, bindings)]));
  return value;
}

function creationContent(templateId: string, bindings: Record<string, string> = {}, overrides: JsonObject = {}): string {
  const template = getNativeCardCreationTemplate(templateId);
  if (!template) return "";
  const content = replaceTemplateBindings(template.content, bindings);
  if (typeof content === "string") return content;
  if (isRecord(content)) Object.assign(content, overrides);
  return pretty(content);
}

function selectCreateRule(): void {
  const rule = selectedCreateRule();
  if (!rule) return;
  const wildcard = rule.pathPattern.includes("**") ? "new-file" : "new-file";
  newFilePath.value = rule.pathPattern.replace("**", wildcard).replace("*", wildcard).replace(/\{[^{}]+\}/g, "new-book");
}

function createFile(): void {
  const path = newFilePath.value.trim();
  const pathFailure = nativeCardPathFailure(path, labels.invalidPath);
  if (pathFailure) {
    operationFailure.value = pathFailure;
    return;
  }
  if (filePaths.value.includes(path)) {
    operationFailure.value = labels.fileExists;
    return;
  }
  const rule = selectedCreateRule();
  if (!rule) return;
  const template = creationTemplateForPath(path);
  const mediaType = template?.mediaType ?? rule.mediaTypes.find((item) => item !== "*/*") ?? "application/octet-stream";
  const content = template
    ? creationContent(template.id, templateBindings(path, template.pathTemplate))
    : path.endsWith(".json") ? "{}" : "";
  try {
    editor.addFile({ path, mediaType, encoding: "utf8", content });
    closeDialog();
    void openFile(path);
    void syncManifest();
  } catch (error) {
    operationFailure.value = humanError(error);
  }
}

async function duplicateFile(path: string): Promise<void> {
  operationFailure.value = "";
  const source = fileContents.value[path] ?? await editor.openFile(path);
  if (!source) return;
  let copyPath = path.replace(/(\.[^/.]+)?$/, ".copy$1");
  let suffix = 2;
  while (filePaths.value.includes(copyPath)) {
    copyPath = path.replace(/(\.[^/.]+)?$/, `.copy-${suffix++}$1`);
  }
  editor.addFile({ ...source, path: copyPath });
  await syncManifest();
  await openFile(copyPath);
}

function openRename(path: string): void {
  activeFile.value = path;
  renameTo.value = path;
  openDialog("rename");
}

async function renameFile(): Promise<void> {
  const from = activeFile.value;
  const to = renameTo.value.trim();
  if (isFixedPackageFile(from, allowedPackageFiles.value.fixedFiles)) {
    operationFailure.value = labels.fixedFileHint;
    return;
  }
  if (to === from) {
    closeDialog();
    return;
  }
  const pathFailure = nativeCardPathFailure(to, labels.invalidPath);
  if (pathFailure) {
    operationFailure.value = pathFailure;
    return;
  }
  if (filePaths.value.includes(to)) {
    operationFailure.value = labels.fileExists;
    return;
  }
  if (!fileContents.value[from] && !(await editor.openFile(from))) return;
  editor.moveFile(from, to);
  await updateStructuredReferences(from, to);
  await syncManifest();
  closeDialogForNavigation();
  await openFile(to);
  sourceEditor.value?.focus();
}

async function updateStructuredReferences(from: string, to: string): Promise<void> {
  const jsonFiles = filePaths.value.filter((path) => path.endsWith(".json") && path !== "manifest.json");
  await readPaths(jsonFiles);
  for (const path of jsonFiles) {
    const file = fileContents.value[path];
    if (!file || file.encoding !== "utf8") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      continue;
    }
    const updated = rewriteStringReferences(parsed, from, to);
    if (updated.changed) editor.writeFile(path, pretty(updated.value));
  }
}

function rewriteStringReferences(value: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  if (typeof value === "string") return { value: value === from ? to : value, changed: value === from };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = rewriteStringReferences(item, from, to);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  if (isRecord(value)) {
    let changed = false;
    const next: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteStringReferences(item, from, to);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }
  return { value, changed: false };
}

async function confirmDeleteFile(): Promise<void> {
  const path = pendingDeletePath.value;
  const fixed = ["manifest.json", "character.json", "openings.json"].includes(path);
  if (fixed) return;
  const references = await findReferences(path);
  if (references.length) {
    operationFailure.value = `${labels.deleteFileDialog}：${references.join("、")}`;
    return;
  }
  editor.deleteFile(path);
  await syncManifest();
  closeDialogForNavigation();
  await openDomain("package");
  await nextTick();
  document.querySelector<HTMLElement>("#save-button")?.focus({ preventScroll: true });
}

async function findReferences(targetPath: string): Promise<string[]> {
  const jsonPaths = filePaths.value.filter((path) => path.endsWith(".json") && path !== targetPath && path !== "manifest.json");
  await readPaths(jsonPaths);
  return findPackageFileReferences(jsonPaths, targetPath, fileContents.value);
}

function openDelete(path: string): void {
  pendingDeletePath.value = path;
  operationFailure.value = "";
  openDialog("delete");
}

async function createNewOpening(): Promise<void> {
  const openings = parseFile("openings.json");
  if (!openings || !Array.isArray(openings.items)) return;
  const items = openings.items.filter(isRecord);
  let suffix = items.length + 1;
  while (items.some((item) => stringValue(item.id) === `opening-${suffix}`)) suffix += 1;
  const id = `opening-${suffix}`;
  const textTemplate = getNativeCardCreationTemplate("openingText");
  const stateTemplate = getNativeCardCreationTemplate("openingInitialState");
  const textFile = textTemplate?.pathTemplate.replace("{openingId}", id) ?? `openings/${id}.txt`;
  editor.addFile({ path: textFile, mediaType: textTemplate?.mediaType ?? "text/plain", encoding: "utf8", content: creationContent("openingText", { openingId: id }) });
  let initialStateFile: string | undefined;
  let initialStateNotice = "";
  if (filePaths.value.includes("state/schema.json")) {
    await editor.openFile("state/schema.json");
    const schema = parseJson("state/schema.json");
    const initialState = createOpeningInitialState(schema);
    initialStateFile = stateTemplate?.pathTemplate.replace("{openingId}", id) ?? `state/initial/${id}.json`;
    editor.addFile({ path: initialStateFile, mediaType: stateTemplate?.mediaType ?? "application/json", encoding: "utf8", content: pretty(initialState?.values ?? {}) });
    if (initialState?.missingRequired.length) initialStateNotice = `请填写这些必需的开场初始变量：${initialState.missingRequired.join("、")}。保存时会按角色变量结构统一检查。`;
    else if (!initialState) initialStateNotice = "请先检查 state/schema.json 的对象结构，再填写此开场的初始变量。";
  }
  items.push({ id, title: `新开场 ${suffix}`, summary: "", kind: "story", audience: "individual", textFile, ...(initialStateFile ? { initialStateFile } : {}) });
  openings.items = items;
  const defaults = isRecord(openings.defaultOpeningIds) ? openings.defaultOpeningIds : {};
  if (!defaults.individual) defaults.individual = id;
  openings.defaultOpeningIds = defaults;
  setJsonFile("openings.json", openings);
  await syncManifest();
  selectedOpening.value = id;
  await openDomain("openings");
  openingInitialStateNotice.value = initialStateNotice;
}

function updateOpeningInitialState(event: Event, key: string): void {
  const value = jsonObjectEntries(openingInitialState.value, "").find(([item]) => item === key)?.[1];
  handleInput(event, openingInitialState.value, key, typeof value === "number" ? "number" : "text");
  openingInitialStateNotice.value = "";
}

function setDefaultOpening(): void {
  const id = stringValue(selectedOpeningRecord.value?.id);
  const openings = parseFile("openings.json");
  if (!id || !openings) return;
  const defaults = isRecord(openings.defaultOpeningIds) ? openings.defaultOpeningIds : {};
  defaults.individual = id;
  openings.defaultOpeningIds = defaults;
  setJsonFile("openings.json", openings);
}

async function removeOpening(): Promise<void> {
  const id = selectedOpening.value;
  const opening = selectedOpeningRecord.value;
  const openings = parseFile("openings.json");
  const items = openings && Array.isArray(openings.items) ? openings.items.filter(isRecord) : [];
  if (!opening || !openings || items.length <= 1) return;
  const remaining = items.filter((item) => stringValue(item.id) !== id);
  openings.items = remaining;
  editor.deleteFile(stringValue(opening.textFile));
  if (opening.initialStateFile) editor.deleteFile(stringValue(opening.initialStateFile));
  const defaults = isRecord(openings.defaultOpeningIds) ? openings.defaultOpeningIds : {};
  if (defaults.individual === id) defaults.individual = stringValue(remaining[0]?.id);
  openings.defaultOpeningIds = defaults;
  setJsonFile("openings.json", openings);
  await syncManifest();
  selectedOpening.value = stringValue(remaining[0]?.id);
  await openDomain("openings");
}

async function createWorldbook(): Promise<void> {
  const id = `book-${Date.now().toString(36)}`;
  const file = `worldbooks/${id}/book.json`;
  const character = parseFile("character.json");
  if (!character) return;
  const books = Array.isArray(character.worldbooks) ? character.worldbooks.filter(isRecord) : [];
  books.push({ id, file, enabled: true });
  character.worldbooks = books;
  setJsonFile("character.json", character);
  const template = getNativeCardCreationTemplate("worldbookIndex");
  const content = creationContent("worldbookIndex", { bookId: id }, { name: "新世界书" });
  editor.addFile({ path: file, mediaType: template?.mediaType ?? "application/json", encoding: "utf8", content });
  selectedBook.value = id;
  selectedEntry.value = "";
  await syncManifest();
  await openDomain("worldbooks");
}

async function createWorldbookEntry(): Promise<void> {
  const bookId = selectedBook.value;
  const bookPath = bookFilePath(bookId);
  const book = parseFile(bookPath);
  if (!book) return;
  const entries = Array.isArray(book.entryFiles) ? book.entryFiles.filter((item): item is string => typeof item === "string") : [];
  failure.value = undefined;
  try {
    const uid = await allocateWorldbookEntryUid(bookId, entries);
    const path = worldbookEntryPath(bookId, uid);
    const template = getNativeCardCreationTemplate("worldbookEntry");
    editor.addFile({ path, mediaType: template?.mediaType ?? "application/json", encoding: "utf8", content: creationContent("worldbookEntry", { bookId, entryId: String(uid) }, { uid, comment: "新条目" }) });
    book.entryFiles = [...entries, path];
    setJsonFile(bookPath, book);
    selectedEntry.value = path;
    await syncManifest();
    await openDomain("worldbooks");
  } catch (error) {
    failure.value = error;
  }
}

async function copyWorldbookEntry(): Promise<void> {
  const source = selectedEntryRecord.value;
  const bookPath = bookFilePath(selectedBook.value);
  const book = parseFile(bookPath);
  if (!source || !book) return;
  const entries = Array.isArray(book.entryFiles) ? book.entryFiles.filter((item): item is string => typeof item === "string") : [];
  failure.value = undefined;
  try {
    const uid = await allocateWorldbookEntryUid(selectedBook.value, entries);
    const path = worldbookEntryPath(selectedBook.value, uid);
    editor.addFile({ path, mediaType: "application/json", encoding: "utf8", content: pretty({ ...source, uid, comment: `${stringValue(source.comment)}（副本）` }) });
    book.entryFiles = [...entries, path];
    setJsonFile(bookPath, book);
    selectedEntry.value = path;
    await syncManifest();
    await openDomain("worldbooks");
  } catch (error) {
    failure.value = error;
  }
}

async function allocateWorldbookEntryUid(bookId: string, entryPaths: string[]): Promise<number> {
  const card = selectedCard.value;
  if (!card) throw new Error(labels.cardNotSelected);
  const directory = `worldbooks/${bookId}/entries/`;
  const packageEntryPaths = filePaths.value.filter((path) => path.startsWith(directory));
  const paths = [...new Set([...entryPaths, ...packageEntryPaths])];
  await readPaths(paths);
  const bookPath = bookFilePath(bookId);
  const savedBook = card.files.some((file) => file.path === bookPath);
  const parsedDraftBook = savedBook ? undefined : nativeCardWorldbookSchema.safeParse(parseFile(bookPath));
  if (!savedBook && !parsedDraftBook?.success) throw new Error(labels.draftBookInvalid);
  const draftBook = parsedDraftBook?.success ? parsedDraftBook.data : undefined;
  return allocateWorldbookEntryUidFromServer(
    (request) => apiClient.nativeCards.allocateEntryUid(request),
    {
      cardId: card.id,
      expectedRevision: card.revision,
      bookId,
      ...(draftBook ? { draftBook } : {}),
    },
    paths,
    fileContents.value,
    labels.uidAllocationFailed,
  );
}

function worldbookEntryPath(bookId: string, uid: number): string {
  const template = getNativeCardCreationTemplate("worldbookEntry")?.pathTemplate ?? "worldbooks/{bookId}/entries/{entryId}.json";
  return template.replace("{bookId}", bookId).replace("{entryId}", String(uid));
}

async function openMoveEntryDialog(): Promise<void> {
  const otherBooks = characterBooks().filter((book) => stringValue(book.id) !== selectedBook.value);
  const target = otherBooks[0];
  if (!target || !selectedEntry.value) return;
  moveEntryTargetBookId.value = stringValue(target.id);
  await readPaths([
    "backend/controllers/config.json",
    stateUpdateProfilePath(),
    ...otherBooks.map((book) => stringValue(book.file)),
    ...otherBooks.flatMap((book) => stringArray(stringValue(book.file), "entryFiles")),
  ]);
  await readPaths(stateUpdateRulePaths());
  openDialog("move-entry");
}

function stateUpdateRulePaths(): string[] {
  return stringArray(stateUpdateProfilePath(), "ruleFiles");
}

function moveEntryBindingSummary(): { controller: number; updater: number; stateRule: number } {
  const entryId = numberValue(selectedEntryRecord.value?.uid, -1);
  const moved = moveWorldbookEntryBindings(
    parseFile("backend/controllers/config.json"),
    selectedBook.value,
    entryId,
    moveEntryTargetBookId.value,
    entryId,
  );
  const stateRule = stateUpdateRulePaths().reduce((count, path) => {
    const result = moveWorldbookEntryBindings(
      parseFile(path), selectedBook.value, entryId, moveEntryTargetBookId.value, entryId,
    );
    return count + (result?.stateRuleBindings ?? 0);
  }, 0);
  return { controller: moved?.controllerBindings ?? 0, updater: moved?.updaterBindings ?? 0, stateRule };
}

async function moveWorldbookEntryToBook(): Promise<void> {
  const sourceBookId = selectedBook.value;
  const targetBookId = moveEntryTargetBookId.value;
  const sourcePath = selectedEntry.value;
  const sourceBookPath = bookFilePath(sourceBookId);
  const targetBookPath = bookFilePath(targetBookId);
  const sourceEntry = parseFile(sourcePath);
  const sourceBook = parseFile(sourceBookPath);
  const targetBook = parseFile(targetBookPath);
  const uid = numberValue(sourceEntry?.uid, -1);
  if (!sourceEntry || !sourceBook || !targetBook || !targetBookId || uid < 0) return;
  if (moveEntryBusy.value) return;
  moveEntryBusy.value = true;
  try {
    const sourceEntries = Array.isArray(sourceBook.entryFiles) ? sourceBook.entryFiles.filter((item): item is string => typeof item === "string") : [];
    const targetEntries = Array.isArray(targetBook.entryFiles) ? targetBook.entryFiles.filter((item): item is string => typeof item === "string") : [];
    const newUid = await allocateWorldbookEntryUid(targetBookId, targetEntries);
    const newPath = worldbookEntryPath(targetBookId, newUid);
    editor.addFile({ path: newPath, mediaType: fileContents.value[sourcePath]?.mediaType ?? "application/json", encoding: "utf8", content: pretty({ ...sourceEntry, uid: newUid }) });
    sourceBook.entryFiles = sourceEntries.filter((path) => path !== sourcePath);
    targetBook.entryFiles = [...targetEntries, newPath];
    setJsonFile(sourceBookPath, sourceBook);
    setJsonFile(targetBookPath, targetBook);

    const controllerPath = "backend/controllers/config.json";
    const controller = moveWorldbookEntryBindings(parseFile(controllerPath), sourceBookId, uid, targetBookId, newUid);
    if (controller && (controller.controllerBindings || controller.updaterBindings)) {
      setJsonFile(controllerPath, controller.configuration);
    }
    await readPaths([stateUpdateProfilePath(), ...stateUpdateRulePaths()]);
    for (const rulePath of stateUpdateRulePaths()) {
      const rules = moveWorldbookEntryBindings(parseFile(rulePath), sourceBookId, uid, targetBookId, newUid);
      if (rules?.stateRuleBindings) setJsonFile(rulePath, rules.configuration);
    }
    editor.deleteFile(sourcePath);
    await syncManifest();
    selectedBook.value = targetBookId;
    selectedEntry.value = newPath;
    closeDialogForNavigation();
    await openDomain("worldbooks");
    await nextTick();
    selectedEntryFocusTarget.value?.focus({ preventScroll: true });
  } catch (error) {
    operationFailure.value = humanError(error);
  } finally {
    moveEntryBusy.value = false;
  }
}

function moveWorldbookEntry(direction: -1 | 1): void {
  const bookPath = bookFilePath(selectedBook.value);
  const book = parseFile(bookPath);
  if (!book || !Array.isArray(book.entryFiles)) return;
  const entries = book.entryFiles.filter((item): item is string => typeof item === "string");
  const index = entries.indexOf(selectedEntry.value);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= entries.length) return;
  const current = entries[index];
  const adjacent = entries[next];
  if (current === undefined || adjacent === undefined) return;
  entries[index] = adjacent;
  entries[next] = current;
  book.entryFiles = entries;
  setJsonFile(bookPath, book);
}

async function removeWorldbookEntry(): Promise<void> {
  const bookPath = bookFilePath(selectedBook.value);
  const book = parseFile(bookPath);
  const entryPath = selectedEntry.value;
  if (!book || !Array.isArray(book.entryFiles) || !entryPath) return;
  const controller = parseFile("backend/controllers/config.json");
  const entryUid = numberValue(selectedEntryRecord.value?.uid, -1);
  const inUse = ["controllerEntries", "updaterEntries"].some((key) => {
    const bindings = Array.isArray(controller?.[key]) ? controller[key] as unknown[] : [];
    return bindings.some((item) => isRecord(item) && item.bookId === selectedBook.value && item.entryId === entryUid);
  });
  if (inUse) {
    operationFailure.value = "提示词控制器引用了此条目。请先在提示词控制器面板解除绑定。";
    return;
  }
  const entries = book.entryFiles.filter((path): path is string => typeof path === "string" && path !== entryPath);
  book.entryFiles = entries;
  setJsonFile(bookPath, book);
  editor.deleteFile(entryPath);
  selectedEntry.value = entries[0] ?? "";
  await syncManifest();
  await openDomain("worldbooks");
}

function openNewFile(): void {
  createFileDialog();
}

function openFileForm(): void {
  editorMode.value = "form";
  domainForFile(activeFile.value);
  void loadDomainFiles(activeDomain.value);
}

function openFileSource(path = currentPath.value): void {
  void openFile(path).then(() => {
    sourceEditor.value?.focus();
  });
}

async function formatJson(): Promise<void> {
  const file = fileContents.value[activeFile.value];
  if (!file || file.encoding !== "utf8") return;
  try {
    editor.writeFile(activeFile.value, pretty(JSON.parse(file.content)));
    await nextTick();
  } catch {
    // The syntax error remains visible in the file editor for correction.
  }
}

function openImportFromHeader(): void {
  beginImport();
}

function openCreateFromHeader(): void {
  if (dirty.value) {
    pendingLeaveAction.value = () => {
      editor.returnToCatalog();
      openCreateDialog();
    };
    openDialog("leave");
    return;
  }
  openCreateDialog();
}

async function createBuildFromSavedRevision(): Promise<void> {
  if (!selectedCard.value || buildEntryRevision.value < 1) return;
  buildSource.value = { revision: buildEntryRevision.value };
  buildTaskFromSaved.value = true;
  await beginBuild();
}

async function createCardFromPublication(): Promise<void> {
  if (!publication.value) return;
  const name = `${displayName.value} · 副本`;
  const created = await editor.createCard(name, publication.value.id);
  if (!created) {
    operationFailure.value = humanError(failure.value);
    return;
  }
  closeDialog();
  history.replaceState(null, "", `${config.path}?id=${encodeURIComponent(created.id)}`);
  await loadDomainFiles("character");
  notify(label("createCard"));
}

async function runPublishedVersion(): Promise<void> {
  const releaseId = publication.value?.releaseId;
  if (!releaseId || publicationSessionBusy.value) return;
  operationFailure.value = "";
  publicationSessionBusy.value = true;
  try {
    await createPublishedReleaseSession({
      releaseId,
      userWebBaseUrl: userWebBaseUrl.value,
      createSession: apiClient.roleReleases.createSession,
      openUrl: (url) => window.location.assign(url),
    });
  } catch (error) {
    operationFailure.value = humanError(error);
  } finally {
    publicationSessionBusy.value = false;
  }
}

function requestLeave(action: "save" | "discard" | "continue"): void {
  if (action === "continue") {
    pendingLeaveAction.value = undefined;
    closeDialog();
    return;
  }
  if (action === "save") {
    const pending = pendingLeaveAction.value;
    pendingLeaveAction.value = undefined;
    void saveUntilClean().then((saved) => {
      if (!saved) return;
      closeDialogForTransition();
      pending?.();
    });
    return;
  }
  const pending = pendingLeaveAction.value;
  pendingLeaveAction.value = undefined;
  closeDialogForTransition();
  pending?.();
}

function unsavedBeforeAction(): void {
  void saveAndContinue();
}

function buildIssuePath(issue: NativeCardIssue): string {
  return `${issue.path}${issue.line ? `:${issue.line}:${issue.column ?? 1}` : ""}`;
}

function sourceValue(path: string): string {
  return fileContents.value[path]?.content ?? "";
}

function imageDataUrl(path: string): string {
  const file = fileContents.value[path];
  if (!file) return "";
  if (file.encoding === "base64") return `data:${file.mediaType};base64,${file.content}`;
  if (file.mediaType === "image/svg+xml") return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`;
  return "";
}

function useFileInForm(path: string): boolean {
  return config.chapters.some((chapter) => chapter.defaultPath === path) ||
    characterBooks().some((book) => stringValue(book.file) === path || stringArray(stringValue(book.file), "entryFiles").includes(path)) ||
    jsonArray("openings.json", "items").some((opening) => opening.textFile === path || opening.initialStateFile === path);
}

function jsonObjectEntries(path: string, property: string): Array<[string, unknown]> {
  const value = property ? valueAt(path, property) : parseJson(path);
  return isRecord(value) ? Object.entries(value) : [];
}

function arrayFile(path: string): JsonObject[] {
  const value = parseJson(path);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function fieldString(path: string, property: string): string {
  return stringValue(valueAt(path, property));
}

function fieldNumber(path: string, property: string): number {
  return numberValue(valueAt(path, property));
}

function fieldBoolean(path: string, property: string): boolean {
  return booleanValue(valueAt(path, property));
}

function scalar(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function inputList(event: Event): string[] {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return [];
  return target.value.split(/[，,]/u).map((item) => item.trim()).filter(Boolean);
}

function handleSelect(event: Event, path: string, property: string, type: "number" | "boolean" | "text"): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const value = type === "number" ? Number(event.target.value) : type === "boolean" ? event.target.value === "true" : event.target.value;
  updateJson(path, property, value);
}

function handleArrayInput(path: string, index: number, property: string, event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const rows = arrayFile(path);
  if (!rows[index]) return;
  rows[index][property] = target.value;
  editor.writeFile(path, pretty(rows));
}

function dirtyPath(path: string): boolean {
  return editor.isPathDirty(path);
}

function domainDirectory(domain: string): string {
  if (domain === "package") return "";
  if (domain === "character") return "character/";
  if (domain === "worldbooks") return "worldbooks/";
  if (domain === "openings") return "openings";
  if (domain === "variables") return "state/";
  if (domain === "agent") return "agents/";
  if (domain === "controller") return "backend/controllers/";
  if (domain === "regex") return "regex/";
  if (domain === "frontend") return "frontend/";
  if (domain === "assets") return "assets/";
  return "";
}

function isDomainFile(path: string, domain: string): boolean {
  if (domain === "assets") return path.startsWith("assets/") || path.startsWith("data/");
  if (domain === "agent") return path.startsWith("agents/") || path.startsWith("backend/variable-tools/") || path.startsWith("backend/validators/");
  return path.startsWith(domainDirectory(domain));
}

async function selectBook(book: JsonObject): Promise<void> {
  selectedBook.value = stringValue(book.id);
  selectedEntry.value = "";
  await loadDomainFiles("worldbooks");
}

function bookEnabled(bookId: string): boolean {
  return booleanValue(characterBooks().find((book) => stringValue(book.id) === bookId)?.enabled);
}

function setBookEnabled(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  updateJson("character.json", `worldbooks.${characterBooks().findIndex((book) => stringValue(book.id) === selectedBook.value)}.enabled`, event.target.checked);
}

function entryStatus(path: string): string {
  return fieldBoolean(path, "constant") ? labels.permanentEntry : labels.keywordTriggeredEntry;
}

function openingIndex(): number {
  return jsonArray("openings.json", "items").findIndex((item) => stringValue(item.id) === selectedOpening.value);
}

function updateOpeningField(field: string, event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  const index = openingIndex();
  if (index < 0) return;
  updateJson("openings.json", `items.${index}.${field}`, target.value);
}

function updateTextFile(event: Event, path: string): void {
  if (event.target instanceof HTMLTextAreaElement) editor.writeFile(path, event.target.value);
}

function isDefaultOpening(id: string): boolean {
  return stringValue(parseFile("openings.json")?.defaultOpeningIds && isRecord(parseFile("openings.json")?.defaultOpeningIds) ? (parseFile("openings.json")?.defaultOpeningIds as JsonObject).individual : "") === id;
}

function stateUpdateProfilePath(): string {
  return stringValue(parseFile("character.json")?.stateUpdate) || "agents/state-update/profile.json";
}

function ruleFilePath(): string {
  const profile = parseFile(stateUpdateProfilePath());
  const files = Array.isArray(profile?.ruleFiles) ? profile.ruleFiles : [];
  return files.find((item): item is string => typeof item === "string") ?? "agents/state-update/rules.json";
}

function createRule(): void {
  const path = ruleFilePath();
  const file = parseJson(path);
  const document = isRecord(file) ? file : { rules: [] };
  const rules = Array.isArray(document.rules) ? document.rules.filter(isRecord) : [];
  rules.push({ id: `rule-${rules.length + 1}`, instruction: "" });
  document.rules = rules;
  if (!fileContents.value[path]) {
    const template = getNativeCardCreationTemplate("stateUpdateRules");
    editor.addFile({ path, mediaType: template?.mediaType ?? "application/json", encoding: "utf8", content: pretty(document) });
    const profilePath = stateUpdateProfilePath();
    const profile = parseFile(profilePath) ?? { updaterPrompt: "", writablePaths: [], stateSchemaFile: "state/schema.json", ruleFiles: [] };
    profile.ruleFiles = [path];
    if (!parseFile(profilePath)) editor.addFile({ path: profilePath, mediaType: "application/json", encoding: "utf8", content: pretty(profile) });
    else setJsonFile(profilePath, profile);
    const character = parseFile("character.json");
    if (character && !character.stateUpdate) { character.stateUpdate = profilePath; setJsonFile("character.json", character); }
  } else editor.writeFile(path, pretty(document));
  void syncManifest();
}

function openNewVariable(): void {
  variableKey.value = "";
  variableType.value = "string";
  variableDescription.value = "";
  openDialog("variable");
}

function openEditVariable(key: string): void {
  variableKey.value = key;
  variableType.value = fieldString("state/schema.json", `properties.${key}.type`) || "string";
  variableDescription.value = fieldString("state/schema.json", `properties.${key}.description`);
  openDialog("variable");
}

function saveVariable(): void {
  const key = variableKey.value.trim();
  if (!key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    operationFailure.value = "变量名称必须以字母或下划线开头，并仅包含字母、数字、下划线或连字符。";
    return;
  }
  const schema = parseFile("state/schema.json") ?? JSON.parse(creationContent("stateSchema")) as JsonObject;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (variableKey.value !== key && Object.hasOwn(properties, key)) {
    operationFailure.value = "变量名称已存在，请填写另一个名称。";
    return;
  }
  properties[key] = { ...(isRecord(properties[key]) ? properties[key] : {}), type: variableType.value, ...(variableDescription.value.trim() ? { description: variableDescription.value.trim() } : {}) };
  schema.properties = properties;
  setJsonFile("state/schema.json", schema);
  if (!fileContents.value["state/schema.json"]) editor.addFile({ path: "state/schema.json", mediaType: "application/json", encoding: "utf8", content: pretty(schema) });
  closeDialog();
  void syncManifest();
}

function changeVariableOwner(key: string, event: Event): void {
  const target = event.target;
  if (target instanceof HTMLSelectElement) updateVariableOwner(key, target.value);
}

function controllerEntries(): JsonObject[] {
  return jsonArray("backend/controllers/config.json", "controllerEntries");
}

function bindControllerEntry(): void {
  bindingBookId.value = selectedBook.value || stringValue(characterBooks()[0]?.id);
  const bookPath = bookFilePath(bindingBookId.value);
  const entries = stringArray(bookPath, "entryFiles");
  bindingEntryId.value = String(numberValue(parseFile(entries[0] ?? "")?.uid, 0));
  openDialog("bind");
}

function saveControllerBinding(): void {
  const book = characterBooks().find((item) => stringValue(item.id) === bindingBookId.value);
  const entryId = Number(bindingEntryId.value);
  if (!book || !Number.isInteger(entryId)) return;
  const path = "backend/controllers/config.json";
  const configFile = parseFile(path) ?? { modulePath: "backend/controllers/prompt.js", variableRoot: "state", variableMacros: [], controllerEntries: [], updaterEntries: [] };
  const entries = Array.isArray(configFile.controllerEntries) ? configFile.controllerEntries.filter(isRecord) : [];
  if (!entries.some((item) => item.bookId === bindingBookId.value && item.entryId === entryId)) entries.push({ bookId: bindingBookId.value, entryId });
  configFile.controllerEntries = entries;
  if (fileContents.value[path]) setJsonFile(path, configFile);
  else editor.addFile({ path, mediaType: "application/json", encoding: "utf8", content: pretty(configFile) });
  const character = parseFile("character.json");
  if (character && !character.promptController) { character.promptController = path; setJsonFile("character.json", character); }
  closeDialog();
  void syncManifest();
}

function unbindControllerEntry(index: number): void {
  const configFile = parseFile("backend/controllers/config.json");
  if (!configFile || !Array.isArray(configFile.controllerEntries)) return;
  configFile.controllerEntries = configFile.controllerEntries.filter((_item, itemIndex) => itemIndex !== index);
  setJsonFile("backend/controllers/config.json", configFile);
}

function dialogTitle(): string {
  if (activeDialog.value === "import") {
    const importTitles: Record<ImportStage, string> = {
      select: label("importDialog"),
      checking: label("importCheckingTitle"),
      invalid: label("importInvalidTitle"),
      ready: label("importReadyTitle"),
      importing: label("importingTitle"),
      "commit-failed": label("importCommitFailedTitle"),
      expired: label("importExpiredTitle"),
      complete: label("importCompleteTitle"),
    };
    return importTitles[importStage.value];
  }
  const titles: Record<DialogKind, string> = {
    create: label("createDialog"), import: label("importDialog"), leave: label("confirmLeave"), "before-action": label("confirmLeave"), check: label("validation"), conflict: label("saveConflictTitle"), settings: label("settings"), preview: label("previewDialog"), publication: label("publishDialog"), build: label("buildDialog"), "build-task": label("resumeTask"), "create-file": label("newContent"), rename: label("renameDialog"), delete: label("deleteFileDialog"), variable: variableKey.value ? label("editVariable") : label("newVariable"), bind: label("bindEntry"), "move-entry": label("moveEntryDialog"),
  };
  return activeDialog.value ? titles[activeDialog.value] : label("pageTitle");
}

async function saveAndBuild(): Promise<void> {
  pendingBuild.value = true;
  const saved = await saveUntilClean();
  if (saved && selectedCard.value) {
    buildSource.value = { revision: selectedCard.value.revision };
    await beginBuild();
  }
  pendingBuild.value = false;
}

function updateVariableOwner(key: string, owner: string): void {
  const profilePath = stringValue(parseFile("character.json")?.stateUpdate);
  const profile = parseFile(profilePath);
  if (!profile) return;
  const pointer = `/${key}`;
  const writable = Array.isArray(profile.writablePaths) ? profile.writablePaths.filter((item) => item !== pointer) : [];
  const derived = Array.isArray(profile.derivedPaths) ? profile.derivedPaths.filter((item) => item !== pointer) : [];
  if (owner === "model") writable.push(pointer);
  if (owner === "derive") derived.push(pointer);
  profile.writablePaths = writable;
  profile.derivedPaths = derived;
  setJsonFile(profilePath, profile);
}

function variableOwner(key: string): string {
  const profilePath = stringValue(parseFile("character.json")?.stateUpdate);
  const profile = parseFile(profilePath);
  const pointer = `/${key}`;
  if (Array.isArray(profile?.writablePaths) && profile.writablePaths.includes(pointer)) return "model";
  if (Array.isArray(profile?.derivedPaths) && profile.derivedPaths.includes(pointer)) return "derive";
  return "fixed";
}

function variableDialog(): void {
  operationFailure.value = "";
  openDialog("create-file");
}

function openPackageDetails(): void {
  void openDomain("package");
}

function dismissToast(): void {
  toastMessage.value = "";
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

function onEditorKeydown(event: KeyboardEvent): void {
  if (event.key.toLocaleLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey)) return;
  if (screen.value !== "editor" || activeDialog.value) return;
  event.preventDefault();
  requestSave();
}

onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("keydown", onEditorKeydown);
  const id = new URLSearchParams(window.location.search).get("id");
  if (id) await loadEditor(id);
  else await editor.loadCatalog();
});

onBeforeUnmount(() => {
  resetImportRequest();
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("keydown", onEditorKeydown);
  if (toastTimer.value) clearTimeout(toastTimer.value);
  if (buildPoll.value) clearInterval(buildPoll.value);
});

watch(() => build.value?.status, (status) => {
  if (status && !["succeeded", "failed"].includes(status)) startBuildPolling();
});

watch(() => selectedCard.value?.id, (cardId, previousCardId) => {
  if (cardId === previousCardId) return;
  previewSessionId.value = "";
  previewSessionUrl.value = "";
  preview.value = null;
  previewTab.value = "page";
  requestedPreviewTab.value = undefined;
  dryRunResult.value = undefined;
  roleView.value = undefined;
  previewLoading.value = false;
  previewFailure.value = "";
  trialTurns.value = [];
  trialFailure.value = "";
  proposalInspection.value = undefined;
  proposalInspectionFailure.value = "";
  if (activeDialog.value === "preview") closeDialogForNavigation();
});

</script>

<template>
  <div class="native-card-editor">
    <header class="appbar">
      <div class="brand">T<span>H</span><b>{{ labels.brand }}</b><i>/</i><span>{{ labels.pageTitle }}</span></div>
      <div class="toplinks">
        <a v-if="screen === 'catalog'" class="toplink" href="/">{{ labels.returnToApps }}</a>
        <button data-action="import" @click="openImportFromHeader">{{ labels.importZip }}</button>
        <button data-action="start-new-role" @click="openCreateFromHeader">{{ labels.newCard }}</button>
      </div>
    </header>

    <template v-if="screen === 'catalog'">
      <main class="catalog-view">
        <div class="catalog-heading">
          <div><div class="eyebrow">{{ labels.brand }}</div><h1>{{ labels.openCatalog }}</h1><p>{{ labels.catalogDescription }}</p></div>
          <div class="inline-actions"><button data-action="import" @click="openImportFromHeader">{{ labels.importZip }}</button><button class="primary" data-action="new-role" @click="openCreateFromHeader">{{ labels.newCard }}</button></div>
        </div>
        <div v-if="failureMessage" class="err" role="alert">{{ failureMessage }}</div>
        <div v-if="loading" class="empty" role="status">{{ labels.loading }}</div>
        <div v-else-if="!cards.length" class="empty">
          <div class="symbol">◇</div><h3>{{ labels.noCards }}</h3><p>{{ labels.emptyCatalogDescription }}</p>
          <div class="actions-inline"><button @click="openImportFromHeader">{{ labels.importZip }}</button><button class="primary" @click="openCreateFromHeader">{{ labels.newCard }}</button></div>
        </div>
        <div v-else class="catalog-grid">
          <article v-for="card in cards" :key="card.id" class="card catalog-card">
            <div class="avatar">{{ Array.from(card.name)[0] ?? "◇" }}</div>
            <div class="grow"><h3>{{ card.name }}</h3><p>{{ labels.savedRevision }} {{ card.revision }} · {{ card.files.length }} {{ labels.fileCountSuffix }}</p><small>{{ card.packageId }}</small></div>
            <button class="primary" :data-card="card.id" @click="loadEditor(card.id)">{{ labels.open }}</button>
          </article>
        </div>
      </main>
    </template>

    <template v-else-if="selectedCard">
      <header class="workspacebar">
        <div class="identity">
          <button class="iconbutton" data-action="menu" :aria-label="labels.openNavigation" @click="sidebarOpen = !sidebarOpen">☰</button>
          <button class="back" data-action="catalog" :aria-label="labels.openCatalog" @click="openCatalog">←</button>
          <div class="avatar small">{{ Array.from(displayName)[0] ?? "◇" }}</div>
          <div><h1 id="role-name">{{ displayName }}</h1><div class="subtitle"><span id="revision" :aria-label="revisionLabel" :title="revisionLabel"><span class="card-id-label">角色卡 #{{ selectedCard.id }}</span><span class="revision-number">{{ revisionNumberLabel }}</span></span><span id="save-state" :class="{ dirty }" role="status">{{ savedState }}</span></div></div>
        </div>
        <div class="actions">
          <button data-action="check" :disabled="validating" @click="requireSaved('check')">{{ labels.check }}</button>
          <button data-action="preview" @click="requireSaved('preview')">{{ labels.preview }}</button>
          <button data-action="export" @click="requireSaved('build')">{{ labels.build }}</button>
          <button data-action="publish" @click="requireSaved('publish')">{{ labels.publish }}</button>
          <button id="save-button" class="primary" data-action="save" :disabled="saving" @click="requestSave">{{ labels.save }}</button>
        </div>
      </header>
      <div class="workspace no-inspector">
        <aside id="sidebar" :class="{ open: sidebarOpen }">
          <div class="sidetabs"><button id="nav-domain" :class="{ active: navigation === 'domain' }" @click="navigation = 'domain'">{{ labels.contentNavigation }}</button><button id="nav-files" :class="{ active: navigation === 'files' }" @click="navigation = 'files'">{{ labels.packageFiles }}</button></div>
          <div class="search"><span>⌕</span><input id="file-search" v-model="search" :placeholder="labels.search" :aria-label="labels.search"></div>
          <nav id="navigation" aria-label="角色卡内容">
            <template v-if="navigation === 'domain'">
              <button v-for="chapter in filteredChapters" :key="chapter.key" class="navitem" :class="{ active: activeDomain === chapter.key }" :data-domain="chapter.key" @click="openDomain(chapter.key)"><span class="navicon">{{ chapter.icon }}</span>{{ label(chapter.labelKey) }}<em v-if="chapter.key === 'worldbooks'">{{ characterBooks().length }}</em></button>
              <div class="sectiontitle nav-section-title"><small>当前内容文件</small><button data-action="new-file" @click="openNewFile">{{ labels.new }}</button></div>
              <button v-for="path in domainFiles(activeDomain)" :key="path" class="treefile" :data-file="path" @click="openFile(path)">{{ path }}</button>
            </template>
            <template v-else>
              <details v-for="[group, paths] in fileGroups" :key="group" class="treegroup" :data-group="group" open>
                <summary>{{ group }} <button v-if="group !== '根目录'" :data-new-directory="`${group}/`" :aria-label="`在 ${group} 中新增`" @click.prevent="openNewFile">＋</button></summary>
                <button v-for="path in paths" :key="path" class="treefile" :class="{ active: path === activeFile }" :title="path" :data-file="path" @click="openFile(path)"><span :class="{ modified: dirtyPath(path) }">{{ dirtyPath(path) ? "●" : "·" }}</span> {{ group === '根目录' ? path : path.slice(group.length + 1) }}</button>
              </details>
            </template>
          </nav>
          <div class="sidebarfoot"><button data-action="new-file" @click="openNewFile">{{ labels.newFile }}</button><button data-action="upload" @click="beginUpload()">{{ labels.upload }}</button><div id="file-count" class="footnote">{{ packageCount }} {{ labels.fileCountSuffix }} · 仅此角色包</div></div>
        </aside>
        <main id="main">
          <div class="editorbar">
            <div><span id="section-name">{{ label(activeDomain) }}</span><div id="file-path" class="filepath">{{ currentPath }}</div></div>
            <div class="segmented"><button data-action="new-file" @click="openNewFile">{{ labels.new }}</button><button id="form-button" :class="{ active: editorMode === 'form' }" :disabled="editorMode === 'source' && !useFileInForm(activeFile)" @click="openFileForm">{{ labels.form }}</button><button id="source-button" :class="{ active: editorMode === 'source' }" @click="openFileSource()">{{ labels.source }}</button></div>
          </div>
          <div id="editor" ref="editorScroll" class="scrollarea" tabindex="-1">
            <div v-if="failureMessage" class="err" role="alert">{{ failureMessage }}</div>
            <div v-for="(issue, index) in failureIssues" :key="index" class="issue"><span class="danger">!</span><div class="grow"><strong>{{ issue.message }}</strong><small>{{ buildIssuePath(issue) }}<span v-if="issue.pointer"> · {{ issue.pointer }}</span></small><small>{{ issue.action }}</small><details v-if="issue.expected"><summary>{{ labels.issueDetails }}</summary><pre>{{ issue.expected }}</pre></details></div><button :data-issue="issue.path" @click="locateIssue(issue)">{{ labels.locate }}</button></div>
            <div v-if="editorMode === 'source'">
              <div v-if="!fileContents[activeFile]" class="empty"><div class="symbol">◇</div><h3>{{ labels.loadingFile }}</h3></div>
              <template v-else>
                <div class="filetools"><button data-action="format-json" :disabled="!activeFile.endsWith('.json')" @click="formatJson">{{ labels.formatJson }}</button><button data-action="rename-current" @click="openRename(activeFile)">{{ labels.renameMove }}</button><button data-action="duplicate-file" @click="duplicateFile(activeFile)">{{ labels.copyFile }}</button><button data-action="delete-file" class="danger" @click="openDelete(activeFile)">{{ labels.deleteFile }}</button></div>
                <template v-if="currentFileIsBinary">
                  <audio v-if="currentFile?.mediaType.startsWith('audio/')" controls :src="`data:${currentFile?.mediaType};base64,${currentFile?.content}`"></audio>
                  <div v-else class="media-preview"><img v-if="currentFile?.mediaType.startsWith('image/')" :src="imageDataUrl(activeFile)" :alt="activeFile"><span v-else class="symbol">♫</span></div>
                  <button data-action="replace-current" @click="beginUpload(activeFile)">{{ labels.replaceFile }}</button>
                </template>
                <template v-else>
                  <textarea id="source-editor" ref="sourceEditor" class="code" spellcheck="false" :aria-label="labels.fileContent" :value="sourceValue(activeFile)" @input="updateCurrentFile"></textarea>
                  <div v-if="currentJsonError" class="err" role="alert">{{ activeFile }}<br>{{ currentJsonError }}<br>{{ labels.jsonInvalid }}<button data-action="form" @click="openFileForm">{{ labels.backToForm }}</button></div>
                </template>
                <div class="hint">{{ activeFile }} · {{ currentFile?.encoding === 'base64' ? currentFile.mediaType : 'UTF-8' }} · {{ dirtyPath(activeFile) ? labels.unsaved : labels.saved }}</div>
              </template>
            </div>

            <div v-else-if="currentJsonError" class="err form-json-guard" role="alert">
              <strong>{{ currentPath }}</strong><br>{{ currentJsonError }}<br>{{ labels.jsonInvalid }}
              <button data-action="open-json-source" @click="openFileSource(currentPath)">{{ labels.openFileView }}</button>
            </div>

            <template v-else-if="activeDomain === 'character'">
              <div class="intro"><div><h2>{{ labels.character }}</h2><p>定义这张角色卡中的人物、故事与叙事基础。</p></div><span class="badge">{{ labels.packageBadge }}</span></div>
              <section class="section"><div class="sectiontitle"><h3>基本信息</h3><small>character.json</small></div><div class="grid">
                <label>{{ labels.characterName }}<input :value="fieldString('character.json', 'name')" @input="handleInput($event, 'character.json', 'name')"></label>
                <label>{{ labels.characterVersion }}<input :value="fieldString('character.json', 'characterVersion')" @input="handleInput($event, 'character.json', 'characterVersion')"></label>
                <label>{{ labels.creator }}<input :value="fieldString('character.json', 'creator')" @input="handleInput($event, 'character.json', 'creator')"></label>
                <label>{{ labels.tags }}<input :value="stringArray('character.json', 'tags').join('，')" @input="updateList('character.json', 'tags', inputList($event))"><div class="hint">使用逗号分隔多个标签</div></label>
              </div></section>
              <section class="section"><div class="sectiontitle"><h3>人物与故事</h3><small>参与提示词组装</small></div><label class="field">{{ labels.description }}<textarea :value="fieldString('character.json', 'description')" @input="handleInput($event, 'character.json', 'description')"></textarea></label><label class="field">{{ labels.personality }}<textarea :value="fieldString('character.json', 'personality')" @input="handleInput($event, 'character.json', 'personality')"></textarea><div class="hint">填写姓名、年龄、身份、性格和人物关系。</div></label><label class="field">{{ labels.scenario }}<textarea :value="fieldString('character.json', 'scenario')" @input="handleInput($event, 'character.json', 'scenario')"></textarea></label></section>
              <section class="section"><label class="field">{{ labels.exampleDialogue }}<textarea :value="fieldString('character.json', 'exampleDialogue')" @input="handleInput($event, 'character.json', 'exampleDialogue')"></textarea></label></section>
            </template>

            <template v-else-if="activeDomain === 'worldbooks'">
              <div class="intro"><div><h2>{{ labels.worldbooks }}</h2><p>知识条目由触发条件决定何时参与提示词组装。</p></div><button data-action="new-book" @click="createWorldbook">＋ 新建世界书</button></div>
              <div v-if="!characterBooks().length" class="empty"><div class="symbol">◇</div><h3>还没有世界书</h3><p>新建一本世界书，然后添加条目。</p><button data-action="new-book" @click="createWorldbook">新建世界书</button></div>
              <template v-else>
                <div class="tabs"><button v-for="book in characterBooks()" :key="stringValue(book.id)" :class="{ active: selectedBook === stringValue(book.id) }" :data-book="stringValue(book.id)" @click="selectBook(book)">{{ stringValue(parseFile(stringValue(book.file))?.name) }} <small>{{ stringArray(stringValue(book.file), 'entryFiles').length }}</small></button></div>
                <div class="card"><div class="grid"><label>世界书名称<input :value="fieldString(bookFilePath(selectedBook), 'name')" @input="handleInput($event, bookFilePath(selectedBook), 'name')"></label><label class="checkrow"><input type="checkbox" :checked="bookEnabled(selectedBook)" @change="setBookEnabled($event)"> 启用这本世界书</label></div><div class="row" style="margin-top:12px"><small>{{ bookFilePath(selectedBook) }}</small><button data-action="new-entry" @click="createWorldbookEntry">＋ 新增条目</button></div></div>
                <div class="booklayout"><div class="bookentries"><button v-for="path in stringArray(bookFilePath(selectedBook), 'entryFiles')" :key="path" :ref="(element) => setSelectedEntryFocusTarget(path, element as Element | null)" class="entryitem" :class="{ active: path === selectedEntry }" data-action="select-entry" :data-entry="path" @click="selectedEntry = path">{{ fieldString(path, 'comment') }}<small>#{{ fieldNumber(path, 'uid') }} · {{ entryStatus(path) }}</small></button></div>
                  <div v-if="selectedEntryRecord"><div class="sectiontitle"><h3>条目 #{{ fieldNumber(selectedEntry, 'uid') }}</h3><div class="inline-actions"><button data-action="copy-entry" @click="copyWorldbookEntry">{{ labels.copyEntry }}</button><button data-action="move-entry-to-book" :disabled="characterBooks().length < 2" @click="openMoveEntryDialog">{{ labels.moveEntry }}</button><button data-action="move-entry-up" @click="moveWorldbookEntry(-1)">{{ labels.moveUp }}</button><button data-action="delete-entry" class="danger" @click="removeWorldbookEntry">{{ labels.remove }}</button></div></div>
                    <label class="field">条目名称<input :value="fieldString(selectedEntry, 'comment')" @input="handleInput($event, selectedEntry, 'comment')"></label><label class="field">条目正文<textarea :value="fieldString(selectedEntry, 'content')" @input="handleInput($event, selectedEntry, 'content')"></textarea></label><label class="field">主关键词<input :value="stringArray(selectedEntry, 'key').join('，')" @input="updateList(selectedEntry, 'key', inputList($event))"><div class="hint">逗号分隔。常驻条目无需关键词命中。</div></label>
                    <div class="grid"><label>触发方式<select :value="fieldBoolean(selectedEntry, 'constant') ? 'true' : 'false'" @change="handleSelect($event, selectedEntry, 'constant', 'boolean')"><option value="true">常驻</option><option value="false">关键词触发</option></select></label><label>条目状态<select :value="fieldBoolean(selectedEntry, 'disable') ? 'true' : 'false'" @change="handleSelect($event, selectedEntry, 'disable', 'boolean')"><option value="false">启用</option><option value="true">停用</option></select></label><label>{{ labels.position }}<select :value="fieldNumber(selectedEntry, 'position')" @change="handleSelect($event, selectedEntry, 'position', 'number')"><option value="0">角色定义之前</option><option value="1">角色定义之后</option><option value="4">指定对话深度</option><option value="7">Outlet：按名称匹配提示词插入位置</option></select></label><label>{{ labels.priority }}<input type="number" :value="fieldNumber(selectedEntry, 'order')" @input="handleInput($event, selectedEntry, 'order', 'number')"></label><label>{{ labels.depth }}<input type="number" :value="fieldNumber(selectedEntry, 'depth')" @input="handleInput($event, selectedEntry, 'depth', 'number')"></label><label>{{ labels.messageRole }}<select :value="fieldNumber(selectedEntry, 'role')" @change="handleSelect($event, selectedEntry, 'role', 'number')"><option value="0">系统</option><option value="1">用户</option><option value="2">助手</option></select></label></div><div class="hint" style="margin-top:18px">更多递归、辅助关键词和匹配设置可在文件视图编辑。</div>
                  </div><div v-else class="empty"><h3>这本世界书还没有条目</h3><p>添加第一条知识。</p><button data-action="new-entry" @click="createWorldbookEntry">新增条目</button></div></div>
              </template>
            </template>

            <template v-else-if="activeDomain === 'openings'">
              <div class="intro"><div><h2>{{ labels.openings }}</h2><p>每个开场保留独立正文和完整初始变量。</p></div><button data-action="new-opening" @click="createNewOpening">＋ 新增开场</button></div>
              <div v-if="!jsonArray('openings.json', 'items').length" class="empty"><h3>还没有开场</h3><p>为角色写一个起点。</p><button data-action="new-opening" @click="createNewOpening">新增开场</button></div>
              <template v-else>
                <div class="tabs"><button v-for="item in jsonArray('openings.json', 'items')" :key="stringValue(item.id)" :data-opening="stringValue(item.id)" :class="{ active: stringValue(item.id) === stringValue(selectedOpeningRecord?.id) }" @click="selectedOpening = stringValue(item.id); openingInitialStateNotice = ''">{{ stringValue(item.title) }} <span v-if="isDefaultOpening(stringValue(item.id))" class="badge">默认</span></button></div>
                <div class="grid"><label>{{ labels.openingTitle }}<input :value="fieldString('openings.json', `items.${openingIndex()}.title`)" @input="updateOpeningField('title', $event)"></label><label>{{ labels.openingKind }}<select :value="fieldString('openings.json', `items.${openingIndex()}.kind`)" @change="updateOpeningField('kind', $event)"><option value="story">剧情开场</option><option value="introduction">作品介绍</option></select></label></div>
                <div class="field" style="margin-top:19px"><label>{{ labels.openingText }}<textarea :value="sourceValue(openingText)" style="min-height:180px" @input="updateTextFile($event, openingText)"></textarea></label><div class="filepath">{{ openingText }}</div></div>
                <template v-if="openingInitialState"><div class="sectiontitle"><h3>{{ labels.openingInitialStateHeading }}</h3><button :data-file="openingInitialState" @click="openFile(openingInitialState)">编辑 JSON</button></div><div v-if="openingInitialStateNotice" class="warning" role="status">{{ openingInitialStateNotice }}</div><div class="grid"> <label v-for="[key, value] in jsonObjectEntries(openingInitialState, '')" :key="key">{{ key }}<input :type="typeof value === 'number' ? 'number' : 'text'" :step="typeof value === 'number' ? 'any' : undefined" :value="scalar(value)" @input="updateOpeningInitialState($event, key)"></label></div></template>
                <div class="actions-inline"><button data-action="default-opening" :disabled="isDefaultOpening(stringValue(selectedOpeningRecord?.id))" @click="setDefaultOpening">设为默认开场</button><button data-action="delete-opening" class="danger" :disabled="jsonArray('openings.json', 'items').length === 1" @click="removeOpening">删除此开场</button></div>
              </template>
            </template>

            <template v-else-if="activeDomain === 'variables'">
              <div class="intro"><div><h2>{{ labels.variables }}</h2><p>设置变量的类型、用途和更新方式。</p></div><button data-action="new-variable" @click="openNewVariable">＋ 新增字段</button></div>
              <div class="warning" style="margin-bottom:20px">初始值在“开场与初始状态”中编辑。字段改名后需要同步规则与初始值。</div>
              <div class="tablewrap"><table class="table"><thead><tr><th>字段 / 用途</th><th>类型</th><th>由谁更新</th><th></th></tr></thead><tbody>
                <tr v-for="[key] in jsonObjectEntries('state/schema.json', 'properties')" :key="key"><td><strong>{{ key }}</strong><div><small>{{ fieldString('state/schema.json', `properties.${key}.description`) }}</small></div></td><td>{{ fieldString('state/schema.json', `properties.${key}.type`) }}</td><td><select :value="variableOwner(key)" @change="changeVariableOwner(key, $event)"><option value="model">变量更新 Agent</option><option value="derive">后端计算函数</option><option value="fixed">固定初始值</option></select></td><td><button :data-edit-variable="key" @click="openEditVariable(key)">编辑</button></td></tr>
              </tbody></table></div>
              <div class="card" style="margin-top:24px"><h3>{{ labels.proposalInspectionTitle }}</h3><p>{{ labels.proposalInspectionHint }}</p><button data-action="variables-preview" style="margin-top:14px" @click="openProposalInspection">{{ labels.proposalOpenInspection }}</button></div>
            </template>

            <template v-else-if="activeDomain === 'agent'">
              <div class="intro"><div><h2>{{ labels.agent }}</h2><p>根据本轮消息生成变量更新提案。</p></div></div>
              <label class="field" style="margin-top:23px">更新提示词<textarea :value="fieldString(stateUpdateProfilePath(), 'updaterPrompt')" @input="handleInput($event, stateUpdateProfilePath(), 'updaterPrompt')"></textarea></label>
              <div class="section"><div class="sectiontitle"><h3>更新规则</h3><button :data-file="ruleFilePath()" @click="openFile(ruleFilePath())">编辑文件</button></div>
                <label v-for="(rule, index) in jsonArray(ruleFilePath(), 'rules')" :key="stringValue(rule.id)" class="field">{{ stringValue(rule.id) }}<textarea style="min-height:70px" :value="stringValue(rule.instruction)" @input="handleInput($event, ruleFilePath(), `rules.${index}.instruction`)"></textarea></label><button data-action="new-rule" @click="createRule">＋ 添加规则</button>
              </div>
              <div class="grid"><label>变量生成工具<select :value="fieldString(stateUpdateProfilePath(), 'deriveScript')" @change="handleInput($event, stateUpdateProfilePath(), 'deriveScript')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('backend/variable-tools/') && item.endsWith('.js'))" :key="path" :value="path">{{ path }}</option></select></label><label>校验模块<select :value="fieldString(stateUpdateProfilePath(), 'validateScript')" @change="handleInput($event, stateUpdateProfilePath(), 'validateScript')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('backend/validators/') && item.endsWith('.js'))" :key="path" :value="path">{{ path }}</option></select></label></div>
            </template>

            <template v-else-if="activeDomain === 'controller'">
              <div class="intro"><div><h2>{{ labels.controller }}</h2><p>通过变量生成世界书条目中需要动态展开的正文。</p></div></div>
              <section class="section"><div class="grid"><label>{{ labels.modulePath }}<select :value="fieldString('backend/controllers/config.json', 'modulePath')" @change="handleInput($event, 'backend/controllers/config.json', 'modulePath')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('backend/controllers/') && item.endsWith('.js'))" :key="path" :value="path">{{ path }}</option></select></label><label>变量根<input :value="fieldString('backend/controllers/config.json', 'variableRoot')" @input="handleInput($event, 'backend/controllers/config.json', 'variableRoot')"></label></div></section>
              <div class="sectiontitle"><h3>世界书条目绑定</h3><button data-action="bind-controller" @click="bindControllerEntry">＋ 绑定条目</button></div>
              <template v-if="controllerEntries().length"><div v-for="(entry, index) in controllerEntries()" :key="`${stringValue(entry.bookId)}:${numberValue(entry.entryId)}`" class="card row"><span>{{ stringValue(entry.bookId) }} / #{{ numberValue(entry.entryId) }}</span><button :data-unbind="index" @click="unbindControllerEntry(index)">解除绑定</button></div></template><div v-else class="empty"><div class="symbol">◇</div><h3>尚未绑定条目</h3><p>选择需要控制器生成正文的世界书条目。</p><button data-action="bind-controller" @click="bindControllerEntry">绑定条目</button></div>
              <button data-action="prompt-preview" @click="requireSaved('preview')">预览提示词组装 →</button>
            </template>

            <template v-else-if="activeDomain === 'regex'">
              <div class="intro"><div><h2>{{ labels.regex }}</h2><p>编辑角色卡的文本处理规则。</p></div></div>
              <div class="filetools regex-filetools"><button data-file="regex/default.json" @click="openFile('regex/default.json')">编辑文件</button></div>
              <div v-for="(rule, index) in arrayFile('regex/default.json')" :key="stringValue(rule.id)" class="card"><label class="checkrow"><input type="checkbox" :checked="!booleanValue(rule.disabled)" @change="handleCheckbox($event, 'regex/default.json', `${index}.disabled`, true, true)">{{ stringValue(rule.scriptName) }}</label><div class="filepath">{{ stringValue(rule.findRegex) }} → {{ stringValue(rule.replaceString) || '空文本' }}</div></div>
            </template>

            <template v-else-if="activeDomain === 'frontend'">
              <div class="intro"><div><h2>{{ labels.frontend }}</h2><p>编辑角色页面入口与包内资源绑定。</p></div><span class="badge">API v1</span></div>
              <div class="grid">
                <label>{{ labels.htmlFile }}<select :value="fieldString('frontend/manifest.json', 'html')" @change="handleInput($event, 'frontend/manifest.json', 'html')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('frontend/') && item.endsWith('.html'))" :key="path" :value="path">{{ path }}</option></select></label>
                <label>{{ labels.cssFile }}<select :value="fieldString('frontend/manifest.json', 'css')" @change="handleInput($event, 'frontend/manifest.json', 'css')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('frontend/') && item.endsWith('.css'))" :key="path" :value="path">{{ path }}</option></select></label>
                <label>{{ labels.scriptFile }}<select :value="fieldString('frontend/manifest.json', 'script')" @change="handleInput($event, 'frontend/manifest.json', 'script')"><option value="">未选择</option><option v-for="path in filePaths.filter((item) => item.startsWith('frontend/') && item.endsWith('.js'))" :key="path" :value="path">{{ path }}</option></select></label>
              </div>
              <div class="filetools" style="margin-top:20px"><button @click="openFile(fieldString('frontend/manifest.json', 'html'))">编辑 HTML</button><button @click="openFile(fieldString('frontend/manifest.json', 'css'))">编辑 CSS</button><button @click="openFile(fieldString('frontend/manifest.json', 'script'))">编辑 JavaScript</button></div>
              <div class="mock-browser"><header>页面预览 · {{ fieldString('frontend/manifest.json', 'html') }}</header><iframe v-if="previewSessionUrl" class="role-preview-frame" :src="previewSessionUrl" title="角色页面预览" sandbox="allow-scripts allow-forms allow-same-origin"></iframe><div v-else class="previewstage"><div class="eyebrow">角色卡预览</div><h2>{{ displayName }}</h2><p>{{ sourceValue(openingText) }}</p><button class="option" data-action="frontend-create-preview" @click="requireSaved('preview')">创建真实预览 →</button></div></div>
            </template>

            <template v-else-if="activeDomain === 'assets'">
              <div class="intro"><div><h2>{{ labels.assets }}</h2><p>上传、查看和替换角色包中的资源。</p></div><button data-action="upload" @click="beginUpload()">{{ labels.upload }}</button></div>
              <div v-if="operationFailure" class="err" role="alert">{{ operationFailure }}</div>
              <div class="media-grid"><div v-for="path in filePaths.filter((item) => item.startsWith('assets/'))" :key="path" class="media-card"><div class="media-preview"><img v-if="fileMediaType(path).startsWith('image/')" :src="imageDataUrl(path)" :alt="path"><span v-else class="symbol">♫</span></div><footer>{{ path.split('/').at(-1) }}<small>{{ path }}</small><div class="inline-actions"><button @click="openFile(path)">查看资源</button><button data-action="replace-media" :data-path="path" @click="beginUpload(path)">{{ labels.replaceFile }}</button><button :data-rename="path" @click="openRename(path)">重命名</button></div></footer></div></div>
            </template>

            <template v-else-if="activeDomain === 'package'">
              <div class="intro"><div><h2>{{ labels.package }}</h2><p>清单跟随文件操作同步更新。</p></div></div>
              <div class="grid"><label>包标识<input :value="fieldString('manifest.json', 'packageId')" @input="handleInput($event, 'manifest.json', 'packageId')"></label><label>格式版本<input :value="fieldString('manifest.json', 'formatVersion')" readonly></label></div>
              <div class="card" style="margin-top:22px"><div class="row"><h3>{{ packageCount }} 个{{ labels.packageFilesHeading }}</h3><button data-file="manifest.json" @click="openFile('manifest.json')">查看完整清单</button></div><p>{{ labels.packageDeliveryDescription }}</p></div>
              <div class="tablewrap"><table class="table"><thead><tr><th>文件</th><th>用途</th><th></th></tr></thead><tbody><tr v-for="path in filePaths.filter((item) => item !== 'manifest.json')" :key="path"><td class="monotext">{{ path }}</td><td><small>{{ filePurpose(path) }}</small></td><td><button :data-file="path" @click="openFile(path)">打开</button></td></tr></tbody></table></div>
            </template>
          </div>
          <footer class="editorfooter"><button id="package-status-button" :hidden="!build" @click="openBuildTask">{{ labels.packageTask }}<span v-if="build"> · 修订 {{ build.revision }}</span></button><span id="editor-status" role="status">{{ editorSavedState }}</span><button id="footer-save-button" class="primary" :disabled="saving" data-action="save" @click="requestSave">{{ labels.save }}</button></footer>
        </main>
      </div>
      <footer class="statusbar"><span><i class="dot"></i> 正在编辑</span><span id="status-right">{{ packageCount }} {{ labels.fileCountSuffix }} · {{ revisionNumberLabel }}</span></footer>
    </template>

    <div v-if="toastMessage" id="toast" role="status" @click="dismissToast">{{ toastMessage }}</div>
    <dialog id="dialog" ref="dialog" v-modal-focus="closeDialog" aria-labelledby="dialog-title">
      <div class="modalhead"><div><div class="eyebrow">{{ labels.dialogEyebrow }}</div><h2 id="dialog-title">{{ dialogTitle() }}</h2></div><button ref="dialogCloseButton" class="iconbutton" data-action="close-dialog" :aria-label="labels.close" @click="closeDialog">×</button></div>
      <div id="dialog-body">
        <template v-if="activeDialog === 'create'"><label>{{ labels.cardName }}<input v-model="newCardName" :placeholder="labels.enterName" @keydown.enter.prevent="createCard"></label><div v-if="operationFailure" class="err">{{ operationFailure }}</div></template>
        <template v-else-if="activeDialog === 'import'">
          <template v-if="importStage === 'select'">
            <p>{{ labels.selectZipHint }}</p><div class="card"><h3>{{ importFile?.name ?? labels.unselectedFile }}</h3><button data-action="pick-zip" @click="chooseImportFile">{{ labels.chooseZip }}</button></div>
          </template>
          <template v-else-if="importStage === 'checking'">
            <p role="status">{{ labels.importCheckingProgress.replace("{name}", importFile?.name ?? "") }}</p><p>{{ labels.importCheckingDetails }}</p>
          </template>
          <template v-else-if="importStage === 'invalid'">
            <div class="err" role="alert">{{ importFailure || labels.importInvalid }}</div>
            <p>{{ labels.importFileLabel }}：{{ importFile?.name ?? labels.unselectedFile }}</p>
            <div v-for="(issue, index) in importPreview?.issues ?? []" :key="index" class="issue"><span class="danger">!</span><div class="grow"><strong>{{ issue.message }}</strong><small v-if="issue.path">{{ labels.filePath }}：{{ issue.path }}<span v-if="issue.pointer"> · {{ issue.pointer }}</span></small><small v-if="issue.line || issue.column">{{ issue.line ? `${labels.line} ${issue.line}` : "" }}{{ issue.line && issue.column ? " · " : "" }}{{ issue.column ? `${labels.column} ${issue.column}` : "" }}</small><small>{{ issue.action }}</small><details v-if="issue.expected"><summary>{{ labels.issueDetails }}</summary><pre>{{ issue.expected }}</pre></details></div></div>
          </template>
          <template v-else-if="importStage === 'ready' && importPreview">
            <div class="success">{{ labels.importReady }}</div><div class="card"><h3>{{ importPreview.name }}</h3><p>{{ importPreview.fileName }} · {{ labels.importFormat }} {{ importPreview.summary?.formatVersion }}</p><p>{{ labels.importIndependentCard }}</p></div>
            <table class="import-resource-summary"><thead><tr><th>{{ labels.importResourceType }}</th><th>{{ labels.importVerified }}</th></tr></thead><tbody><tr v-for="item in importResourceSummary()" :key="item.name"><td>{{ item.name }}</td><td>{{ item.result }}</td></tr></tbody></table><p>{{ labels.importSystemConfiguration }}</p>
          </template>
          <template v-else-if="importStage === 'importing'">
            <p role="status">{{ labels.importingProgress }}</p><p>{{ importFile?.name }}</p>
          </template>
          <template v-else-if="importStage === 'commit-failed' || importStage === 'expired'">
            <div class="err" role="alert">{{ importFailure }}</div><p v-if="importStage === 'commit-failed'">{{ labels.importCommitFailureDetails }}</p>
          </template>
          <template v-else-if="importStage === 'complete' && importedCard">
            <div class="success">{{ importedCard?.name }}{{ labels.importCreatedSuffix }}</div>
            <p>{{ labels.importedCardLabel }} #{{ importedCard.id }} · {{ labels.importSavedRevision }} {{ importedCard.revision }}</p>
            <p>{{ importedCard.files.length }} {{ labels.importCompleteFiles }}</p>
          </template>
        </template>
        <template v-else-if="activeDialog === 'leave'"><p>{{ labels.leaveMessage }}</p><div v-if="failureMessage" class="err">{{ failureMessage }}</div></template>
        <template v-else-if="activeDialog === 'before-action'"><p>{{ labels.checkBeforeAction }}</p></template>
        <template v-else-if="activeDialog === 'check'">
          <p>检查当前已保存修订的包文件、格式、必需入口和资源引用。</p><div v-if="validating" role="status">正在检查角色包…</div><div v-else-if="validation?.valid" class="success">✓ {{ packageCount }} {{ labels.validFileCount }}，已识别的引用均存在。</div><div v-else-if="validation" class="err">{{ labels.packageIssues }}</div>
          <div v-for="(issue, index) in validation?.issues ?? []" :key="index" class="issue"><span class="danger">!</span><div class="grow"><strong>{{ issue.message }}</strong><small>{{ buildIssuePath(issue) }}<span v-if="issue.pointer"> · {{ issue.pointer }}</span></small><small>{{ issue.action }}</small><details v-if="issue.expected"><summary>{{ labels.issueDetails }}</summary><pre>{{ issue.expected }}</pre></details></div><button :data-issue="issue.path" @click="locateIssue(issue)">{{ labels.locate }}</button></div>
          <div v-if="operationFailure" class="err" role="alert">{{ operationFailure }}</div>
        </template>
        <template v-else-if="activeDialog === 'conflict'"><p>{{ labels.saveConflict }}</p><p>{{ labels.remoteRevision }} {{ conflict?.currentRevision }}</p><label v-if="conflictPaths.length">冲突文件<select :value="selectedConflictPath" @change="selectConflictPath(($event.target as HTMLSelectElement).value)"><option v-for="path in conflictPaths" :key="path" :value="path">{{ path }}</option></select></label><div v-if="selectedConflictPath" class="compare"><label>{{ labels.localFile }}<pre>{{ sourceValue(selectedConflictPath) }}</pre></label><label>{{ labels.serverFile }}<pre>{{ editor.conflictFiles.value[selectedConflictPath]?.content ?? labels.loadingConflictFile }}</pre></label></div><div v-if="failureMessage" class="err">{{ failureMessage }}</div></template>
        <template v-else-if="activeDialog === 'settings'">
          <p>{{ labels.systemConfiguration }}：系统运行配置不会写入角色包。</p>
          <div v-if="systemBusy" role="status">正在读取运行配置…</div>
          <label>{{ labels.preset }}<select v-model="selectedPreset" @change="loadPresetVersions"><option value="">{{ labels.choose }}</option><option v-for="item in presetOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>{{ labels.version }}<select v-model="selectedPresetVersion"><option value="">{{ labels.choose }}</option><option v-for="item in presetVersionOptions" :key="item.id" :value="item.id">{{ item.versionNo }} · {{ item.id }}</option></select></label>
          <label>{{ labels.userPersona }}<select v-model="selectedUser"><option value="">{{ labels.choose }}</option><option v-for="item in userOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>{{ labels.promptMode }}<select v-model="selectedPromptMode"><option v-for="mode in roleReleasePromptModes" :key="mode" :value="mode">{{ mode }}</option></select></label>
          <div class="grid">
            <label>{{ labels.narratorModel }}<select v-model="selectedNarratorModel"><option value="">{{ labels.choose }}</option><option v-for="item in modelOptions.filter((model) => model.status === 'active')" :key="item.id" :value="item.id">{{ item.provider }} · {{ item.modelId }}</option></select><small class="hint">{{ labels.systemDefault }}：{{ systemRuntimeSummary("narrator") }}</small></label>
            <label v-if="stateUpdateRequired">{{ labels.stateUpdaterModel }}（{{ stateUpdaterSlot }}）<select v-model="selectedStateUpdaterModel"><option value="">{{ labels.choose }}</option><option v-for="item in modelOptions.filter((model) => model.status === 'active')" :key="item.id" :value="item.id">{{ item.provider }} · {{ item.modelId }}</option></select><small class="hint">{{ labels.systemDefault }}：{{ systemRuntimeSummary(stateUpdaterSlot) }}</small></label>
          </div>
          <div v-if="stateUpdateRequired" class="grid">
            <label>{{ labels.statePromptPreset }}<select v-model="selectedStatePreset" @change="loadStatePresetVersions"><option value="">{{ labels.useProfilePreset }}</option><option v-for="item in presetOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label v-if="selectedStatePreset">{{ labels.statePromptPresetVersion }}<select v-model="selectedStatePresetVersion"><option value="">{{ labels.choose }}</option><option v-for="item in statePresetVersionOptions" :key="item.id" :value="item.id">{{ item.versionNo }} · {{ item.id }}</option></select></label>
            <label>{{ labels.stateHistoryTurns }}<input type="number" min="0" step="1" :placeholder="String(roleStatePolicy.defaultHistoryTurns)" :value="selectedStateHistoryTurns" @input="selectedStateHistoryTurns = ($event.target as HTMLInputElement).value"></label>
          </div>
          <div v-if="!systemBusy && systemConfigurationHint" class="warning" role="status">{{ systemConfigurationHint }}</div>
          <label v-if="systemAction === 'preview'">{{ labels.openings }}<select v-model="selectedOpening"><option v-for="item in jsonArray('openings.json', 'items')" :key="stringValue(item.id)" :value="stringValue(item.id)">{{ stringValue(item.title) }}</option></select></label>
          <label v-if="systemAction === 'preview'">预览会话类型<select v-model="selectedSessionType"><option value="individual">单人</option><option value="group">群组</option></select></label>
          <label v-else>版本说明<input v-model="publicationNote" maxlength="1000" placeholder="记录此版本的主要变化"></label>
          <div v-if="operationFailure" class="err">{{ operationFailure }}</div>
        </template>
        <template v-else-if="activeDialog === 'preview'">
          <div class="tabs"><button v-for="tab in previewTabs" :key="tab.id" :class="{ active: previewTab === tab.id }" :data-preview="tab.id" @click="openPreviewTab(tab.id)">{{ label(tab.label) }}</button></div>
          <div class="card"><p>{{ labels.usingRevision }} {{ preview?.revision }} · 会话 {{ previewSessionId }}</p></div>
          <div v-if="previewFailure" class="err">{{ previewFailure }}</div>
          <div v-if="previewTab === 'page'" class="mock-browser"><header>角色卡 #{{ selectedCard?.id }} · 修订 {{ preview?.revision }}</header><iframe v-if="previewSessionUrl" class="role-preview-frame" :src="previewSessionUrl" title="角色页面预览" sandbox="allow-scripts allow-forms allow-same-origin"></iframe><div v-else class="previewstage"><h2>{{ displayName }}</h2><p>预览会话已建立，正在读取角色页面。</p></div></div>
          <template v-else-if="previewTab === 'prompt'"><label style="margin-top:15px">{{ labels.dryRunInput }}<input v-model="dryRunInput"></label><button ref="dryRunButton" style="margin:12px 0" :disabled="previewLoading" @click="runPromptDryRun">{{ labels.showPrompt }}</button><div v-if="dryRunResult"><div class="card"><strong>{{ dryRunResult.messages.length }} 条消息 · Token 估算 {{ dryRunResult.tokenEstimate }}</strong></div><pre class="testlog">{{ pretty(dryRunResult.messages) }}</pre><details><summary>组装追踪</summary><pre class="testlog">{{ pretty(dryRunResult.runtimeTrace ?? dryRunResult.assembly) }}</pre></details></div></template>
          <template v-else-if="previewTab === 'state-prompt'">
            <p>{{ labels.statePromptPreviewHint }}</p>
            <label>{{ labels.statePromptFloor }}<input v-model="stateDryRunFloorId" :placeholder="labels.statePromptFloorPlaceholder"></label>
            <button ref="stateDryRunButton" style="margin:12px 0" :disabled="previewLoading" @click="runStatePromptDryRun">{{ labels.showStatePrompt }}</button>
            <div v-if="stateDryRunResult"><div class="card"><strong>{{ stateDryRunResult.messages.length }} {{ labels.statePromptMessageCount }} · {{ stateDryRunResult.token_usage.total }} Token</strong></div><pre class="testlog">{{ pretty(stateDryRunResult.messages) }}</pre><details><summary>{{ labels.statePromptTrace }}</summary><pre class="testlog">{{ pretty(stateDryRunResult) }}</pre></details></div>
          </template>
          <template v-else-if="previewTab === 'variables'">
            <section class="section proposal-inspection">
              <div class="sectiontitle"><h3>{{ labels.proposalInspectionTitle }}</h3><span class="badge">{{ labels.proposalInspectionBadge }}</span></div>
              <p>{{ labels.proposalInspectionDetails }}</p>
              <div class="compare" style="margin-top:16px"><div><label>初始变量</label><pre>{{ pretty(roleView?.initial.variables ?? {}) }}</pre></div><div><label>当前变量</label><pre>{{ pretty(roleView?.current.variables ?? {}) }}</pre></div></div>
              <div class="actions-inline"><button ref="variableRefreshButton" :disabled="previewLoading" @click="refreshRoleView">读取当前变量</button></div>
              <label class="field">{{ labels.sourceMessagesInput }}<textarea v-model="sourceMessagesJson" class="proposal-input" spellcheck="false" :aria-label="labels.sourceMessagesInput"></textarea></label>
              <label class="field">{{ labels.proposalInput }}<textarea v-model="proposalJson" class="proposal-input" spellcheck="false" :aria-label="labels.proposalInput"></textarea></label>
              <div class="hint">{{ labels.proposalInputHint }}</div>
              <button ref="proposalInspectButton" class="primary" data-action="inspect-proposal" :disabled="proposalInspectionBusy || !previewSessionId" @click="inspectStateProposal">{{ proposalInspectionBusy ? labels.proposalInspectionChecking : labels.proposalInspectionRun }}</button>
              <div v-if="proposalInspectionFailure" class="err" role="alert">{{ proposalInspectionFailure }}</div>
              <template v-if="proposalInspection">
                <div :class="proposalInspection.valid ? 'success' : 'err'" role="status">{{ proposalInspection.valid ? labels.proposalInspectionValid : labels.proposalInspectionInvalid }}</div>
                <div class="proposal-results">
                  <div class="card"><h3>{{ labels.proposalBefore }}</h3><pre>{{ pretty(proposalInspection.before) }}</pre></div>
                  <div class="card"><h3>{{ labels.proposalCandidate }}</h3><pre>{{ pretty(proposalInspection.candidate) }}</pre></div>
                  <div class="card"><h3>{{ labels.proposalDerived }}</h3><pre>{{ pretty(proposalInspection.derived) }}</pre></div>
                </div>
                <div v-if="proposalInspection.issues.length" class="section"><h3>{{ labels.proposalIssues }}</h3><div v-for="(issue, index) in proposalInspection.issues" :key="`${issue.code}:${index}`" class="issue"><span class="danger">!</span><div class="grow"><strong>{{ issue.message }}</strong><pre v-if="issue.details !== undefined">{{ pretty(issue.details) }}</pre></div></div></div>
              </template>
            </section>
          </template>
          <template v-else><div id="trial-log" style="max-height:270px;overflow:auto;margin-top:10px"><div v-for="(turn, index) in trialTurns" :key="`${index}:${turn.role}`" class="turn" :class="turn.role">{{ turn.content }}</div></div><label style="margin-top:14px">{{ labels.trialMessage }}<textarea v-model="trialInput" style="min-height:66px" :placeholder="labels.trialPlaceholder" @keydown.enter.exact.prevent="sendTrial"></textarea></label><div class="row" style="margin-top:10px"><small>{{ labels.trialSendHint }}</small><button ref="sendTrialButton" class="primary" data-action="send-trial" :disabled="trialSending" @click="sendTrial">{{ trialSending ? labels.sendPending : labels.send }}</button></div><div v-if="trialFailure" class="err">{{ trialFailure }}</div></template>
        </template>
        <template v-else-if="activeDialog === 'publication'"><div class="success">✓ {{ labels.publishSuccess }}</div><ul class="checklist"><li>修订 {{ publication?.revision }} 已固定到角色版本</li><li>版本标识 {{ publication?.id }}</li><li>角色版本 ID {{ publication?.characterVersionId }}</li><li v-if="publication?.note">版本说明：{{ publication.note }}</li></ul><button data-action="create-card-from-version" @click="createCardFromPublication">基于此版本建立角色卡</button><div v-if="operationFailure" class="err" role="alert">{{ operationFailure }}</div></template>
        <template v-else-if="activeDialog === 'build'">
          <label>{{ labels.buildSource }}<select :value="buildSourceOption()" @change="chooseBuildSource(($event.target as HTMLSelectElement).value)"><option value="current">{{ labels.buildCurrent }} · {{ labels.buildSourceRevision }} {{ buildEntryRevision }}</option><option v-if="selectedCard && selectedCard.revision !== buildEntryRevision" value="latest-saved">{{ labels.buildLatestSaved }} · {{ labels.buildSourceRevision }} {{ selectedCard.revision }}</option><option v-for="version in selectedCard?.versions ?? []" :key="version.id" :value="version.id">{{ labels.buildVersion }} {{ version.id }} · {{ labels.buildSourceRevision }} {{ version.revision }}</option></select></label>
          <div v-if="dirty" class="warning" style="margin-top:16px">{{ labels.buildLastSavedWarning.replace("{revision}", String(buildEntryRevision)) }}</div>
          <div class="card" style="margin-top:16px"><div class="eyebrow">{{ labels.buildSourceRevision }}</div><h3 v-if="buildSummaryForSource(buildSource).name">{{ buildSummaryForSource(buildSource).name }}.zip</h3><h3 v-else>{{ buildSourceLabel() }}</h3><p><span v-if="buildSummaryForSource(buildSource).fileCount !== undefined">{{ buildSummaryForSource(buildSource).fileCount }} {{ labels.fileCountSuffix }} · </span>{{ buildSourceLabel() }}</p><p>{{ labels.buildSourceFixedNotice }}</p></div>
          <div v-if="operationFailure" class="err">{{ operationFailure }}</div>
        </template>
        <template v-else-if="activeDialog === 'build-task'"><div class="card"><h3 v-if="buildTaskSummary?.name">{{ buildTaskSummary.name }}.zip</h3><h3 v-else>{{ labels.buildSourceRevision }} {{ buildTaskSummary?.revision ?? build?.revision }}</h3><p>{{ labels.buildSourceRevision }} {{ buildTaskSummary?.revision ?? build?.revision }}<span v-if="buildTaskSummary?.versionId ?? build?.versionId"> · {{ buildTaskSummary?.versionId ?? build?.versionId }}</span><span v-if="buildTaskSummary?.fileCount !== undefined"> · {{ buildTaskSummary.fileCount }} {{ labels.fileCountSuffix }}</span></p></div><div v-if="build && !['succeeded','failed'].includes(build.status)" role="status">{{ buildPhaseLabel() }}…<progress max="3" :value="build.stage === 'validating' ? 1 : build.stage === 'archiving' ? 2 : 3"></progress><p>可以关闭窗口继续编辑，通过底部“打包任务”查看任务。</p></div><div v-else-if="build?.status === 'failed'"><p>{{ labels.failedStage }}：{{ buildPhaseLabel() }}</p><div class="err" role="alert">{{ buildIssueSummary() }}</div></div><div v-else class="success">{{ labels.buildSucceeded }}</div><div v-if="operationFailure" class="err" role="alert"><strong>{{ buildTaskFailureAction === 'retry' ? labels.retryBuildRequestFailed : labels.downloadActionFailed }}</strong><p>{{ operationFailure }}</p></div><div v-if="dirty || (build && build.revision !== selectedCard?.revision)" class="warning">{{ labels.buildNewChanges }}</div></template>
        <template v-else-if="activeDialog === 'create-file'"><div class="grid"><label>{{ labels.targetDirectory }}<select v-model.number="newFileRuleIndex" @change="selectCreateRule"><option v-for="(rule, index) in allowedPackageFiles.directoryRules" :key="rule.pathPattern" :value="index">{{ rule.pathPattern }} · {{ rule.purpose }}</option></select></label><label>{{ labels.filePath }}<input v-model="newFilePath"></label></div><div class="hint">{{ selectedCreateRule()?.schema }} · {{ selectedCreateRule()?.extensions.join('、') }}</div><div v-if="operationFailure" class="err">{{ operationFailure }}</div></template>
        <template v-else-if="activeDialog === 'rename'"><p>{{ fixedFile ? labels.fixedFileHint : labels.renameReferenceHint }}</p><label>{{ labels.currentPath }}<input :value="activeFile" readonly></label><label v-if="!fixedFile" style="margin-top:14px">{{ labels.newPath }}<input v-model="renameTo"></label><div v-if="operationFailure" class="err">{{ operationFailure }}</div></template>
        <template v-else-if="activeDialog === 'delete'"><p>{{ pendingDeletePath }}</p><p>删除后文件会从清单中移除。</p><div v-if="operationFailure" class="err">{{ operationFailure }}</div></template>
        <template v-else-if="activeDialog === 'move-entry'"><p>{{ labels.moveEntryHint }}</p><label>{{ labels.moveEntryTarget }}<select v-model="moveEntryTargetBookId"><option v-for="book in characterBooks().filter((item) => stringValue(item.id) !== selectedBook)" :key="stringValue(book.id)" :value="stringValue(book.id)">{{ stringValue(parseFile(stringValue(book.file))?.name) }}</option></select></label><div class="card"><h3>{{ labels.moveEntryReferences }}</h3><p>{{ labels.controllerEntries }}：{{ moveEntryBindingSummary().controller }}</p><p>{{ labels.updaterEntries }}：{{ moveEntryBindingSummary().updater }}</p><p>{{ labels.stateRuleEntries }}：{{ moveEntryBindingSummary().stateRule }}</p><p v-if="!moveEntryBindingSummary().controller && !moveEntryBindingSummary().updater && !moveEntryBindingSummary().stateRule">{{ labels.noMoveEntryReferences }}</p></div><div v-if="operationFailure" class="err" role="alert">{{ operationFailure }}</div></template>
      </div>
      <div id="dialog-footer" class="modalfoot">
        <template v-if="activeDialog === 'create'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button class="primary" data-action="create-role" :disabled="loading" @click="createCard">{{ labels.createCard }}</button></template>
        <template v-else-if="activeDialog === 'import'">
          <template v-if="importStage === 'select'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button ref="importCheckButton" class="primary" data-action="import-check" :disabled="!importFile || checkingImport" @click="checkImport">{{ labels.checkPackage }}</button></template>
          <button v-else-if="importStage === 'checking'" data-action="close-dialog" @click="closeDialog">{{ labels.close }}</button>
          <template v-else-if="importStage === 'invalid' || importStage === 'expired'"><button data-action="close-dialog" @click="closeDialog">{{ labels.close }}</button><button data-action="pick-zip" @click="chooseImportFile">{{ labels.chooseAnotherZip }}</button><button v-if="importFile && /\.zip$/i.test(importFile.name)" ref="importRecheckButton" class="primary" data-action="import-recheck" @click="checkImport">{{ labels.retryImportCheck }}</button></template>
          <template v-else-if="importStage === 'ready'"><button data-action="import-back" @click="returnToImportSelection">{{ labels.returnToImportSelection }}</button><button ref="importConfirmButton" class="primary" data-action="import-confirm" @click="confirmImport">{{ labels.confirmImport }}</button></template>
          <button v-else-if="importStage === 'importing'" data-action="import-progress" disabled>{{ labels.importingButton }}</button>
          <template v-else-if="importStage === 'commit-failed'"><button data-action="close-dialog" @click="closeDialog">{{ labels.close }}</button><button ref="importRetryConfirmButton" class="primary" data-action="import-confirm-retry" @click="confirmImport">{{ labels.retryImport }}</button></template>
          <button v-else-if="importStage === 'complete'" ref="importOpenCardButton" class="primary" data-action="open-imported-card" @click="openImportedCard">{{ labels.openImportedCard }}</button>
        </template>
        <template v-else-if="activeDialog === 'leave'"><button data-action="keep-editing" @click="requestLeave('continue')">{{ labels.keepEditing }}</button><button class="danger" data-action="discard-leave" @click="requestLeave('discard')">{{ labels.discardChanges }}</button><button class="primary" data-action="save-leave" @click="requestLeave('save')">{{ labels.saveAndLeave }}</button></template>
        <template v-else-if="activeDialog === 'before-action'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button class="primary" data-action="save-and-continue" @click="unsavedBeforeAction">{{ saveActionLabel }}</button></template>
        <template v-else-if="activeDialog === 'check'"><button data-action="close-dialog" @click="closeDialog">{{ labels.dismiss }}</button><button v-if="validation && !validation.valid" data-action="check" @click="requireSaved('check')">{{ labels.retry }}</button></template>
        <template v-else-if="activeDialog === 'conflict'"><button data-action="keep-local" @click="resolveConflict(false)">{{ labels.keepLocal }}</button><button data-action="use-server" @click="resolveConflict(true)">{{ labels.useServer }}</button><button data-action="close-dialog" @click="closeDialog">{{ labels.keepEditing }}</button></template>
        <template v-else-if="activeDialog === 'settings'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button ref="systemActionButton" class="primary" data-action="system-action" :disabled="systemBusy || !systemConfiguration" @click="runSystemAction">{{ systemAction === 'preview' ? labels.preview : labels.publish }}</button></template>
        <template v-else-if="activeDialog === 'preview'"><button data-action="restart-preview" @click="restartPreview">{{ labels.restartPreview }}</button><button data-action="close-dialog" @click="closeDialog">{{ labels.dismiss }}</button></template>
        <template v-else-if="activeDialog === 'publication'"><button data-action="version-draft" @click="closeDialog">继续编辑</button><button class="primary" data-action="run-published-version" :disabled="publicationSessionBusy" @click="runPublishedVersion">{{ publicationSessionBusy ? labels.openingPublishedSession : labels.runPublishedVersion }}</button><button data-action="close-dialog" @click="closeDialog">{{ labels.dismiss }}</button></template>
        <template v-else-if="activeDialog === 'build'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button v-if="dirty && selectedCard?.revision" data-action="package-start" @click="createBuildFromSavedRevision">{{ labels.buildLastSaved }}</button><button class="primary" data-action="package-save" :disabled="pendingBuild" @click="dirty ? saveAndBuild() : beginBuild()">{{ dirty ? labels.buildSaveFirst : labels.startBuild }}</button></template>
        <template v-else-if="activeDialog === 'build-task'"><button data-action="close-dialog" @click="closeDialog">{{ labels.keepEditing }}</button><button v-if="build?.status === 'failed'" class="primary" data-action="package-retry" @click="retryBuild">{{ labels.retryBuild }}</button><template v-if="build?.status === 'succeeded'"><button data-action="package-rebuild" @click="openBuildDialog()">{{ labels.repackage }}</button><button class="primary" data-action="package-download" @click="downloadBuild">{{ labels.download }}</button></template></template>
        <template v-else-if="activeDialog === 'create-file'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button class="primary" data-action="create-resource" @click="createFile">{{ labels.createAndOpen }}</button></template>
        <template v-else-if="activeDialog === 'rename'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button v-if="!fixedFile" class="primary" data-action="rename-confirm" @click="renameFile">{{ labels.confirmChange }}</button></template>
        <template v-else-if="activeDialog === 'delete'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button class="danger" data-action="delete-file-confirm" @click="confirmDeleteFile">{{ labels.deleteFileConfirm }}</button></template>
        <template v-else-if="activeDialog === 'move-entry'"><button data-action="close-dialog" @click="closeDialog">{{ labels.cancel }}</button><button class="primary" data-action="move-entry-confirm" :disabled="moveEntryBusy || !moveEntryTargetBookId" @click="moveWorldbookEntryToBook">{{ moveEntryBusy ? labels.working : labels.confirmMoveEntry }}</button></template>
      </div>
    </dialog>
    <input id="upload-input" ref="uploadInput" hidden type="file" multiple @change="uploadFile">
    <input id="import-input" ref="importInput" hidden type="file" accept=".zip,application/zip" @change="selectImportFile">
  </div>
</template>
