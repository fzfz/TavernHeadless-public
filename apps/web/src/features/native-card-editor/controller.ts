import { computed, ref } from "vue";
import type {
  NativeCard,
  NativeCardBuild,
  NativeCardBuildSource,
  NativeCardFileContent,
  NativeCardImport,
  NativeCardIssue,
  NativeCardPublication,
  NativeCardSystemConfiguration,
  NativeCardValidation,
  NativeCardPreviewResult,
} from "@tavern/shared";
import type { NativeCardDownloadArtifact, NativeCardsResource } from "@tavern/sdk";

export type NativeCardEditorScreen = "catalog" | "editor";
export type NativeCardFileMove = { from: string; to: string };
export type NativeCardRevisionConflict = {
  currentRevision: number;
  path?: string;
};

export type NativeCardBuildDownload = NativeCardDownloadArtifact;

export function createNativeCardEditorController(sdk: NativeCardsResource) {
  const cards = ref<NativeCard[]>([]);
  const selectedCard = ref<NativeCard | null>(null);
  const fileContents = ref<Record<string, NativeCardFileContent>>({});
  const originalContents = ref<Record<string, NativeCardFileContent>>({});
  const conflictFiles = ref<Record<string, NativeCardFileContent>>({});
  const movedFiles = ref<NativeCardFileMove[]>([]);
  const deletedFiles = ref<string[]>([]);
  const createdFiles = ref<string[]>([]);
  const dirty = computed(() => {
    if (movedFiles.value.length || deletedFiles.value.length || createdFiles.value.length) return true;
    return Object.entries(fileContents.value).some(([path, current]) => {
      const original = originalContents.value[path];
      if (!original) return false;
      return (
        original.content !== current.content ||
        original.encoding !== current.encoding ||
        original.mediaType !== current.mediaType
      );
    });
  });
  const importPreview = ref<NativeCardImport | null>(null);
  const checkingImport = ref(false);
  const confirmingImport = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const validating = ref(false);
  const validation = ref<NativeCardValidation | null>(null);
  const conflict = ref<NativeCardRevisionConflict | null>(null);
  const publication = ref<NativeCardPublication | null>(null);
  const preview = ref<NativeCardPreviewResult | null>(null);
  const build = ref<NativeCardBuild | null>(null);
  const failure = ref<unknown>();
  const screen = computed<NativeCardEditorScreen>(() =>
    selectedCard.value ? "editor" : "catalog",
  );
  let confirmation: Promise<NativeCard | undefined> | undefined;
  let importGeneration = 0;
  let savingPromise: Promise<NativeCard | undefined> | undefined;

  function resetDraft(): void {
    fileContents.value = {};
    originalContents.value = {};
    movedFiles.value = [];
    deletedFiles.value = [];
    createdFiles.value = [];
    validation.value = null;
    conflict.value = null;
    conflictFiles.value = {};
    publication.value = null;
    preview.value = null;
    build.value = null;
    failure.value = undefined;
  }

  async function loadCatalog(): Promise<void> {
    loading.value = true;
    failure.value = undefined;
    try {
      cards.value = await sdk.list();
    } catch (error) {
      failure.value = error;
    } finally {
      loading.value = false;
    }
  }

  async function openCard(cardId: string): Promise<NativeCard | undefined> {
    loading.value = true;
    failure.value = undefined;
    try {
      const card = await sdk.get({ cardId });
      resetDraft();
      selectedCard.value = card;
      return card;
    } catch (error) {
      failure.value = error;
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  async function createCard(name: string, sourceVersionId?: string): Promise<NativeCard | undefined> {
    loading.value = true;
    failure.value = undefined;
    try {
      const card = await sdk.create({ name, ...(sourceVersionId ? { sourceVersionId } : {}) });
      resetDraft();
      selectedCard.value = card;
      cards.value = [card, ...cards.value.filter((item) => item.id !== card.id)];
      return card;
    } catch (error) {
      failure.value = error;
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  function returnToCatalog(): void {
    selectedCard.value = null;
    resetDraft();
  }

  async function openFile(
    path: string,
    revision = selectedCard.value?.revision,
  ): Promise<NativeCardFileContent | undefined> {
    const card = selectedCard.value;
    if (!card) return undefined;
    const cached = fileContents.value[path];
    if (cached && revision === card.revision) return cached;
    try {
      const file = await sdk.readFile({ cardId: card.id, path, revision });
      if (revision === card.revision) {
        fileContents.value = { ...fileContents.value, [path]: file };
        if (!originalContents.value[path]) {
          originalContents.value = { ...originalContents.value, [path]: file };
        }
      }
      return file;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  function writeFile(
    path: string,
    content: string,
    encoding = fileContents.value[path]?.encoding ?? "utf8",
    mediaType = fileContents.value[path]?.mediaType ?? "text/plain",
  ): void {
    const current = fileContents.value[path];
    fileContents.value = {
      ...fileContents.value,
      [path]: {
        path,
        mediaType,
        encoding,
        content,
      },
    };
    validation.value = null;
  }

  function addFile(file: NativeCardFileContent): void {
    if (selectedCard.value?.files.some((item) => item.path === file.path)) {
      throw new Error(`文件 ${file.path} 已存在。`);
    }
    if (fileContents.value[file.path]) throw new Error(`文件 ${file.path} 已存在。`);
    fileContents.value = { ...fileContents.value, [file.path]: file };
    createdFiles.value = [...new Set([...createdFiles.value, file.path])];
    validation.value = null;
  }

  function isPathDirty(path: string): boolean {
    if (createdFiles.value.includes(path) || deletedFiles.value.includes(path)) return true;
    if (movedFiles.value.some((move) => move.from === path || move.to === path)) return true;
    const current = fileContents.value[path];
    const original = originalContents.value[path];
    return Boolean(current && original && (
      original.content !== current.content ||
      original.encoding !== current.encoding ||
      original.mediaType !== current.mediaType
    ));
  }

  function moveFile(from: string, to: string): void {
    const file = fileContents.value[from];
    if (!file) throw new Error(`请先打开文件 ${from}。`);
    if (fileContents.value[to] || selectedCard.value?.files.some((item) => item.path === to)) {
      throw new Error(`文件 ${to} 已存在。`);
    }
    const previousMove = movedFiles.value.find((item) => item.to === from);
    const source = previousMove?.from ?? from;
    const isCreatedFile = createdFiles.value.includes(from) || createdFiles.value.includes(source);
    const originalFile = originalContents.value[from] ?? originalContents.value[source];
    movedFiles.value = [
      ...movedFiles.value.filter((item) => item.from !== source && item.to !== from),
      ...(!isCreatedFile && selectedCard.value?.files.some((item) => item.path === source)
        ? [{ from: source, to }]
        : []),
    ];
    createdFiles.value = [
      ...createdFiles.value.filter((path) => path !== from && path !== source),
      ...(isCreatedFile ? [to] : []),
    ];
    const { [from]: _removed, ...remaining } = fileContents.value;
    fileContents.value = {
      ...remaining,
      [to]: { ...file, path: to },
    };
    const remainingOriginals = Object.fromEntries(
      Object.entries(originalContents.value).filter(([path]) => path !== from && path !== source),
    );
    originalContents.value = !isCreatedFile && originalFile
      ? { ...remainingOriginals, [to]: originalFile }
      : remainingOriginals;
    validation.value = null;
  }

  function deleteFile(path: string): void {
    if (!fileContents.value[path] && !selectedCard.value?.files.some((item) => item.path === path)) {
      return;
    }
    const incomingMove = movedFiles.value.find((item) => item.to === path);
    const wasCreated = createdFiles.value.includes(path);
    if (wasCreated) {
      createdFiles.value = createdFiles.value.filter((item) => item !== path);
    } else if (incomingMove) {
      movedFiles.value = movedFiles.value.filter((item) => item !== incomingMove);
      deletedFiles.value = [...new Set([...deletedFiles.value, incomingMove.from])];
    } else if (selectedCard.value?.files.some((item) => item.path === path)) {
      deletedFiles.value = [...new Set([...deletedFiles.value, path])];
    }
    const { [path]: _removed, ...remaining } = fileContents.value;
    fileContents.value = remaining;
    delete originalContents.value[path];
    validation.value = null;
  }

  function saveOperations() {
    const card = selectedCard.value;
    if (!card) return [];
    const operations: Array<
      | { op: "write"; path: string; content: string; encoding: "utf8" | "base64" }
      | { op: "move"; path: string; to: string }
      | { op: "delete"; path: string }
    > = [];
    for (const move of movedFiles.value) operations.push({ op: "move", path: move.from, to: move.to });
    for (const path of deletedFiles.value) operations.push({ op: "delete", path });
    for (const [path, file] of Object.entries(fileContents.value)) {
      const originalPath = movedFiles.value.find((item) => item.to === path)?.from ?? path;
      const original = originalContents.value[path] ?? originalContents.value[originalPath];
      if (createdFiles.value.includes(path) || (original && (
        original.content !== file.content ||
        original.encoding !== file.encoding ||
        original.mediaType !== file.mediaType
      ))) {
        operations.push({
          op: "write",
          path,
          encoding: file.encoding,
          content: file.content,
        });
      }
    }
    return operations;
  }

  function findActualRevision(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined;
    const details = "details" in error ? error.details : undefined;
    if (details && typeof details === "object" && "actualRevision" in details) {
      const revision = details.actualRevision;
      return typeof revision === "number" ? revision : undefined;
    }
    return undefined;
  }

  function errorCode(error: unknown): string | undefined {
    return error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  }

  function save(): Promise<NativeCard | undefined> {
    const card = selectedCard.value;
    if (!card || savingPromise) return savingPromise ?? Promise.resolve(undefined);
    const operations = saveOperations();
    if (operations.length === 0) return Promise.resolve(card);
    const requestContents = { ...fileContents.value };
    const requestOriginals = { ...originalContents.value };
    const requestMoves = movedFiles.value.map((move) => ({ ...move }));
    const requestDeletes = [...deletedFiles.value];
    const requestCreates = [...createdFiles.value];

    saving.value = true;
    failure.value = undefined;
    conflict.value = null;
    conflictFiles.value = {};
    savingPromise = sdk
      .save({ cardId: card.id, expectedRevision: card.revision, operations })
      .then((saved) => {
        selectedCard.value = saved;
        cards.value = cards.value.map((item) => item.id === saved.id ? saved : item);
        const savedPaths = new Set(saved.files.map((file) => file.path));
        const savedBaseline: Record<string, NativeCardFileContent> = {};
        for (const [path, file] of Object.entries(requestOriginals)) {
          const move = requestMoves.find((item) => item.from === path);
          const committedPath = move?.to ?? path;
          if (savedPaths.has(committedPath) && !requestDeletes.includes(path)) {
            const snapshot = requestContents[committedPath] ?? (move ? { ...file, path: committedPath } : file);
            savedBaseline[committedPath] = snapshot;
          }
        }
        for (const [path, file] of Object.entries(requestContents)) {
          if (savedPaths.has(path)) savedBaseline[path] = file;
        }
        originalContents.value = savedBaseline;
        movedFiles.value = movedFiles.value.filter((move) =>
          !requestMoves.some((savedMove) => savedMove.from === move.from && savedMove.to === move.to),
        );
        deletedFiles.value = deletedFiles.value.filter((path) => !requestDeletes.includes(path));
        createdFiles.value = createdFiles.value.filter((path) => !requestCreates.includes(path));
        validation.value = null;
        return saved;
      })
      .catch((error: unknown) => {
        failure.value = error;
        if (errorCode(error) === "NATIVE_CARD_REVISION_CONFLICT") {
          conflict.value = {
            currentRevision: findActualRevision(error) ?? card.revision,
          };
        }
        return undefined;
      })
      .finally(() => {
        saving.value = false;
        savingPromise = undefined;
      });
    return savingPromise;
  }

  async function acceptServerRevision(): Promise<boolean> {
    const card = selectedCard.value;
    const currentRevision = conflict.value?.currentRevision;
    if (!card || currentRevision === undefined) return false;
    try {
      const refreshed = await sdk.get({ cardId: card.id });
      const savedPaths = new Set(refreshed.files.map((file) => file.path));
      const cacheEntries = Object.entries(fileContents.value);
      const cleanCachedPaths = cacheEntries
        .filter(([path]) => !isPathDirty(path))
        .map(([path]) => path);
      const freshFiles = await Promise.all(cleanCachedPaths.map(async (path) => {
        if (!savedPaths.has(path)) return [path, undefined] as const;
        const file = await sdk.readFile({ cardId: refreshed.id, path, revision: refreshed.revision });
        return [path, file] as const;
      }));
      const nextContents = { ...fileContents.value };
      const nextOriginals = { ...originalContents.value };
      for (const [path, file] of freshFiles) {
        if (!file) {
          delete nextContents[path];
          delete nextOriginals[path];
          continue;
        }
        nextContents[path] = file;
        nextOriginals[path] = file;
      }
      selectedCard.value = refreshed;
      cards.value = cards.value.map((item) => item.id === refreshed.id ? refreshed : item);
      fileContents.value = nextContents;
      originalContents.value = nextOriginals;
      conflictFiles.value = {};
      conflict.value = { currentRevision: refreshed.revision };
      return true;
    } catch (error) {
      failure.value = error;
      return false;
    }
  }

  async function readConflictFile(path: string): Promise<NativeCardFileContent | undefined> {
    const card = selectedCard.value;
    const revision = conflict.value?.currentRevision;
    if (!card || revision === undefined) return undefined;
    try {
      const file = await sdk.readFile({ cardId: card.id, path, revision });
      conflictFiles.value = { ...conflictFiles.value, [path]: file };
      return file;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function useServerFile(path: string): Promise<void> {
    const card = selectedCard.value;
    const revision = conflict.value?.currentRevision;
    if (!card || revision === undefined) return;
    const file = conflictFiles.value[path] ?? await readConflictFile(path);
    if (!file) return;
    fileContents.value = { ...fileContents.value, [path]: file };
    originalContents.value = { ...originalContents.value, [path]: file };
  }

  async function validate(): Promise<NativeCardValidation | undefined> {
    const card = selectedCard.value;
    if (!card) return undefined;
    validating.value = true;
    failure.value = undefined;
    try {
      validation.value = await sdk.validate({ cardId: card.id, revision: card.revision });
      return validation.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    } finally {
      validating.value = false;
    }
  }

  async function publish(
    configuration: NativeCardSystemConfiguration,
    note?: string,
  ): Promise<NativeCardPublication | undefined> {
    const card = selectedCard.value;
    if (!card || dirty.value) return undefined;
    failure.value = undefined;
    try {
      publication.value = await sdk.publish({
        cardId: card.id,
        revision: card.revision,
        configuration,
        ...(note?.trim() ? { note: note.trim() } : {}),
      });
      return publication.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function createPreview(
    configuration: NativeCardSystemConfiguration,
    openingId?: string,
    userId?: string,
    sessionType?: "individual" | "group",
  ): Promise<NativeCardPreviewResult | undefined> {
    const card = selectedCard.value;
    if (!card || dirty.value) return undefined;
    failure.value = undefined;
    try {
      preview.value = await sdk.createPreview({
        cardId: card.id,
        revision: card.revision,
        configuration,
        ...(openingId ? { openingId } : {}),
        ...(userId ? { userId } : {}),
        ...(sessionType ? { sessionType } : {}),
      });
      return preview.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function createBuild(source: NativeCardBuildSource): Promise<NativeCardBuild | undefined> {
    const card = selectedCard.value;
    if (!card) return undefined;
    failure.value = undefined;
    try {
      build.value = await sdk.createBuild({ cardId: card.id, source });
      return build.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function refreshBuild(buildId = build.value?.id): Promise<NativeCardBuild | undefined> {
    if (!buildId) return undefined;
    try {
      build.value = await sdk.getBuild({ buildId });
      return build.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function retryBuild(): Promise<NativeCardBuild | undefined> {
    if (!build.value) return undefined;
    try {
      build.value = await sdk.retryBuild({ buildId: build.value.id });
      return build.value;
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  async function downloadBuild(): Promise<NativeCardBuildDownload | undefined> {
    const currentBuild = build.value;
    if (!currentBuild || currentBuild.status !== "succeeded") return undefined;
    try {
      return await sdk.downloadArtifact({ buildId: currentBuild.id });
    } catch (error) {
      failure.value = error;
      return undefined;
    }
  }

  function resetImport(): void {
    importGeneration += 1;
    importPreview.value = null;
    checkingImport.value = false;
    confirmingImport.value = false;
    confirmation = undefined;
  }

  async function checkImport(file: Blob, fileName?: string): Promise<boolean> {
    const generation = ++importGeneration;
    checkingImport.value = true;
    failure.value = undefined;
    importPreview.value = null;
    try {
      const checked = await sdk.checkImport({ file, fileName });
      if (generation === importGeneration) importPreview.value = checked;
    } catch (error) {
      if (generation === importGeneration) failure.value = error;
    } finally {
      if (generation === importGeneration) checkingImport.value = false;
    }
    return generation === importGeneration;
  }

  function confirmImport(): Promise<NativeCard | undefined> {
    const preview = importPreview.value;
    if (!preview || preview.status !== "ready") return Promise.resolve(undefined);
    if (confirmation) return confirmation;

    const generation = importGeneration;
    confirmingImport.value = true;
    failure.value = undefined;
    confirmation = sdk
      .confirmImport({ importId: preview.id })
      .then((card) => {
        if (generation !== importGeneration) return undefined;
        resetDraft();
        selectedCard.value = card;
        cards.value = [card, ...cards.value.filter((item) => item.id !== card.id)];
        importPreview.value = null;
        return card;
      })
      .catch((error: unknown) => {
        if (generation === importGeneration) failure.value = error;
        return undefined;
      })
      .finally(() => {
        if (generation === importGeneration) {
          confirmingImport.value = false;
          confirmation = undefined;
        }
      });
    return confirmation;
  }

  function focusIssue(issue: NativeCardIssue): string {
    return issue.path;
  }

  return {
    cards,
    selectedCard,
    fileContents,
    originalContents,
    conflictFiles,
    movedFiles,
    deletedFiles,
    createdFiles,
    isPathDirty,
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
    loadCatalog,
    openCard,
    createCard,
    returnToCatalog,
    openFile,
    writeFile,
    addFile,
    moveFile,
    deleteFile,
    save,
    acceptServerRevision,
    useServerFile,
    readConflictFile,
    validate,
    publish,
    createPreview,
    createBuild,
    refreshBuild,
    retryBuild,
    downloadBuild,
    resetImport,
    checkImport,
    confirmImport,
    focusIssue,
  };
}
