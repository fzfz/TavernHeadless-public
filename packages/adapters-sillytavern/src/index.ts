// ── Types ─────────────────────────────────────────────
export type {
  STPreset,
  STPresetImportReport,
  STPromptEntry,
  STPromptEntryBehavior,
  STPromptOrderItem,
  STPromptOrderTrack,
  STPromptPlacement,
} from "./types/preset.js";
export { DEFAULT_PROMPT_ORDER_CHARACTER_ID } from "./types/preset.js";
export type { STChatHeader, STChatMessage } from "./types/chat.js";
export type { STWorldBook, STWorldBookEntry } from "./types/worldbook.js";
export { WI_POSITION, WI_LOGIC, WI_ROLE } from "./types/worldbook.js";
export type { WIPosition, WILogic, WIRole } from "./types/worldbook.js";
export type { STRegexScript } from "./types/regex.js";
export { REGEX_PLACEMENT, SUBSTITUTE_REGEX } from "./types/regex.js";
export type { RegexPlacement, SubstituteRegex } from "./types/regex.js";
export type {
  CharacterCardFormat,
  CharacterCoreFields,
  CharacterGreetingSet,
  CharacterMetadataFields,
  CharacterProfile,
  CharacterPromptFields,
  ImportedCharacterCard,
  STCharacterCard,
} from "./types/character.js";

// ── Parsers ───────────────────────────────────────────
export {
  parsePreset,
  resolvePromptOrderCharacterId,
} from "./parsers/preset-parser.js";
export {
  asRecord,
  LEGACY_PRESET_FIELD_MAP,
  normalizeEditorOrderContexts,
  normalizeOrderItems,
  normalizeStoredPreset,
  omitRecordKeys,
  PRESET_ORDER_CONTEXT_KNOWN_KEYS,
  PRESET_PROMPT_KNOWN_KEYS,
  PRESET_RESERVED_TOP_LEVEL_KEYS,
  readConfiguredDefaultCharacterId,
  readRawOrderContexts,
  readRawPromptList,
  resolveDefaultCharacterId,
  toEditorEntry,
  toInteger,
  toOptionalInteger,
  toPresetEditorDocument,
  toRawPresetFromEditor,
  toRawPresetFromLegacy,
} from "./preset-editor.js";
export type {
  JsonRecord,
  PresetEditorDocument,
  PresetEditorDocumentInput,
  PresetEditorEntry,
  PresetEditorOrderContext,
  PresetEditorOrderItem,
} from "./preset-editor.js";
export { parseWorldBook } from "./parsers/worldbook-parser.js";
export { parseRegexScripts } from "./parsers/regex-parser.js";
export {
  parseCharacterCard,
  parseCharacterCardLegacy,
  parseCharacterCardV2,
  parseCharacterCardV3,
} from "./parsers/character-parser.js";
export { normalizeImportedCharacterCard } from "./parsers/character-normalizer.js";
export {
  parseChatFile,
  parseSendDate,
  groupMessagesIntoFloors,
} from "./parsers/chat-parser.js";
export type {
  ParsedChat,
  FloorGroup,
  GroupedMessage,
} from "./parsers/chat-parser.js";

// ── Serializers ───────────────────────────────────────
export {
  snapshotToStCharacterCard,
  snapshotToCharacterCardV3,
} from "./serializers/character-serializer.js";
export type {
  CharacterSnapshotInput,
  STCharacterCardV2,
  STCharacterCardV3,
} from "./serializers/character-serializer.js";
export { scriptsToStRegexArray } from "./serializers/regex-serializer.js";
export type { STRawRegexScript } from "./serializers/regex-serializer.js";

// ── Engines ───────────────────────────────────────────
export { triggerWorldBook, triggerWorldBooks, WorldbookTriggerError } from "./worldbook/trigger-engine.js";
export type {
  TriggerContext,
  TriggerResult,
  DepthEntry,
  TriggerMatchSourceKind,
  TriggerFirstMatch,
  MatchTrace,
  ActivationTrace,
  TriggerDecisionTrace,
  TriggerDependencies,
  TriggerBookInput,
} from "./worldbook/trigger-engine.js";
export {
  applyRegexScripts,
  applyRegexScriptsWithTrace,
} from "./regex/regex-engine.js";
export type {
  RegexContext,
  RegexExecutionChannel,
  RegexExecutionTraceResult,
  RegexTraceSkipReason,
  RegexTraceSkippedRule,
} from "./regex/regex-engine.js";

// ── Assemblers ────────────────────────────────────────
export { assembleCompat } from "./compat-assembler.js";
export type { CompatAssemblerInput } from "./compat-assembler.js";
export { assembleCompatPlus } from "./compat-plus-assembler.js";
export type {
  CompatPlusAssemblerInput,
  CompatPlusRenderableInjection,
} from "./compat-plus-assembler.js";

// ── Native Imported Group ─────────────────────────────
export { buildImportedPresetPromptGraph } from "./preset-to-native-group.js";
export { buildNativeContributorNodes } from "./preset-to-native-group.js";
export type {
  BuildImportedPresetPromptGraphOptions,
  BuildNativeContributorNodeInput,
} from "./preset-to-native-group.js";

export * from "./role-migrations/regex.js";

export * from "./role-migrations/mvu-controller.js";

export * from "./role-migrations/mvu-agent.js";

export * from "./role-migrations/preset-output.js";

export * from "./role-migrations/preset-import.js";

export * from "./role-migrations/openings.js";

export * from "./role-migrations/error.js";
