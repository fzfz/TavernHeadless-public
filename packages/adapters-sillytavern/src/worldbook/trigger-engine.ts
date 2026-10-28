import type { PromptRunIntent } from '@tavern/core';
import { apiErrorMessages, type WorldbookDecisionOutcome, type WorldbookDecisionStage } from '@tavern/shared';
import type { STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION } from '../types/worldbook.js';
import { worldbookRunIntentSchema, worldbookTriggerExtensionsSchema, type WorldbookTriggerExtensions } from './trigger-runtime.schema.js';

// ── 公开类型 ──────────────────────────────────────────

export interface TriggerScanSources {
  personaDescription?: string;
  characterDescription?: string;
  characterPersonality?: string;
  characterDepthPrompt?: string;
  scenario?: string;
  creatorNotes?: string;
  injections?: string[];
}

export type TriggerMatchSourceKind =
  | 'message'
  | 'persona_description'
  | 'character_description'
  | 'character_personality'
  | 'character_depth_prompt'
  | 'scenario'
  | 'creator_notes'
  | 'injection'
  | 'recursion_buffer';

export interface HaystackSegment {
  kind: TriggerMatchSourceKind;
  text: string;
  messageIndexFromLatest?: number;
  injectionIndex?: number;
}

export interface TriggerFirstMatch {
  sourceKind: TriggerMatchSourceKind;
  messageIndexFromLatest?: number;
  injectionIndex?: number;
  matchedKey: string;
  matchedKeyScope: 'primary' | 'secondary';
  matchedKeyType: 'plain' | 'regex';
  charStart: number;
  charEnd: number;
  excerpt: string;
}

export interface MatchTrace {
  matched: boolean;
  matchedKey: string;
  matchedKeyScope: 'primary' | 'secondary';
  matchedKeyType: 'plain' | 'regex';
  charStart: number;
  charEnd: number;
  segmentIndex: number;
}

export interface ActivationTrace {
  mode: 'constant' | 'triggered';
  recursionLevel: number;
  firstMatch: TriggerFirstMatch | null;
}

export interface TriggerDecisionTrace {
  uid: number;
  stage: WorldbookDecisionStage;
  outcome: WorldbookDecisionOutcome;
  intent?: PromptRunIntent;
  messageCount?: number;
  delay?: number;
  group?: string;
  probability?: number;
  randomDraw?: number;
}

export class WorldbookTriggerError extends Error {
  constructor(
    public readonly code: 'WORLDBOOK_TRIGGER_INPUT_INVALID' | 'WORLDBOOK_TRIGGER_RANDOM_INVALID',
    public readonly path: string,
  ) {
    super(apiErrorMessages[code].replace('{path}', path));
    this.name = 'WorldbookTriggerError';
  }
}

/** 触发引擎的扫描上下文 */
export interface TriggerContext {
  /** 最近的聊天消息（从新到旧） */
  messages: string[];
  /** 当前生成动作；旧调用方未指定时按普通发送处理 */
  intent?: PromptRunIntent;
  /** 全局扫描深度（扫描最近 N 条消息） */
  scanDepth: number;
  /** 全局大小写敏感 */
  caseSensitive: boolean;
  /** 全局全词匹配 */
  matchWholeWords: boolean;
  /** 是否启用递归扫描 */
  recursive?: boolean;
  /** 最大递归步数（0 = 不限制） */
  maxRecursionSteps?: number;
  /** 扩展扫描源（按条目扩展字段控制是否参与匹配） */
  scanSources?: TriggerScanSources;
  /** 是否返回命中轨迹 */
  traceEnabled?: boolean;
}

/** @depth 条目的触发结果 */
export interface DepthEntry {
  entry: STWorldBookEntry;
  depth: number;
  role: number;
}

/** 触发引擎的输出 */
export interface TriggerResult {
  /** 所有被激活的条目（按 order 降序排列） */
  activated: STWorldBookEntry[];
  /** position=before(0) 的条目 */
  before: STWorldBookEntry[];
  /** position=after(1) 的条目 */
  after: STWorldBookEntry[];
  /** position=atDepth(4) 的条目 */
  atDepth: DepthEntry[];
  /** position=AN_TOP(2) 的条目 */
  anTop: STWorldBookEntry[];
  /** position=AN_BOTTOM(3) 的条目 */
  anBottom: STWorldBookEntry[];
  /** position=EM_TOP(5) 的条目 */
  emTop: STWorldBookEntry[];
  /** position=EM_BOTTOM(6) 的条目 */
  emBottom: STWorldBookEntry[];
  /** position=outlet(7) 的条目，按 outletName 分组 */
  outletEntries?: Record<string, STWorldBookEntry[]>;
  /** debug 模式下返回，每个 activated entry 的首个命中轨迹 */
  activationTraces?: Map<number, ActivationTrace>;
  /** debug 模式下返回，记录动作、消息数、分组和概率的选择结果 */
  decisionTraces?: TriggerDecisionTrace[];
}

export interface TriggerDependencies {
  nextRandom?: () => number;
}

export interface TriggerBookInput {
  entries: STWorldBookEntry[];
  context: TriggerContext;
}

type ScanState = 'INITIAL' | 'RECURSION';

// ── 内部工具 ──────────────────────────────────────────

/**
 * 解析斜杠分隔的正则表达式字符串。
 * 匹配格式：/pattern/flags
 * @returns 编译好的 RegExp，如果不是合法正则则返回 null
 */
function parseRegex(input: string): RegExp | null {
  const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match) return null;

  let [, pattern, flags] = match;
  // 检查未转义的斜杠
  if (pattern!.match(/(^|[^\\])\//)) return null;
  // 反转义斜杠
  pattern = pattern!.replace('\\/', '/');

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildExcerpt(text: string, start: number, end: number): string {
  const excerptStart = Math.max(0, start - 30);
  const excerptEnd = Math.min(text.length, end + 30);
  return text.slice(excerptStart, excerptEnd);
}

function compareMatchTrace(left: MatchTrace, right: MatchTrace): number {
  if (left.segmentIndex !== right.segmentIndex) {
    return left.segmentIndex - right.segmentIndex;
  }

  if (left.charStart !== right.charStart) {
    return left.charStart - right.charStart;
  }

  if (left.charEnd !== right.charEnd) {
    return left.charEnd - right.charEnd;
  }

  return 0;
}

function findPlainTextMatch(
  haystack: string,
  needle: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): { start: number; end: number } | null {
  if (!needle) {
    return null;
  }

  const escaped = escapeRegExp(needle);
  const flags = caseSensitive ? '' : 'i';

  if (matchWholeWords) {
    const words = needle.trim().split(/\s+/);
    if (words.length === 1) {
      const regex = new RegExp(`(^|\\W)(${escaped})(?=$|\\W)`, flags);
      const match = regex.exec(haystack);
      if (!match) {
        return null;
      }

      const prefix = match[1] ?? '';
      const keyword = match[2] ?? '';
      const start = match.index + prefix.length;
      return { start, end: start + keyword.length };
    }
  }

  const regex = new RegExp(escaped, flags);
  const match = regex.exec(haystack);
  if (!match) {
    return null;
  }

  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}

/**
 * 检查单个关键词是否在文本中命中。
 */
function matchKey(
  haystack: string,
  needle: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  return matchKeyWithTrace(haystack, needle, caseSensitive, matchWholeWords) !== null;
}

function matchKeyWithTrace(
  haystack: string,
  needle: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): Omit<MatchTrace, 'matchedKey' | 'matchedKeyScope' | 'segmentIndex'> | null {
  const regex = parseRegex(needle);
  if (regex) {
    regex.lastIndex = 0;
    const match = regex.exec(haystack);
    if (!match) {
      return null;
    }

    return {
      matched: true,
      matchedKeyType: 'regex',
      charStart: match.index,
      charEnd: match.index + match[0].length,
    };
  }

  const plainMatch = findPlainTextMatch(haystack, needle, caseSensitive, matchWholeWords);
  if (!plainMatch) {
    return null;
  }

  return {
    matched: true,
    matchedKeyType: 'plain',
    charStart: plainMatch.start,
    charEnd: plainMatch.end,
  };
}

/**
 * 检查一组关键词是否在文本中命中（至少一个命中即返回 true）。
 */
function matchAnyKey(
  haystack: string,
  keys: string[],
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  return keys.some((key) => matchKey(haystack, key, caseSensitive, matchWholeWords));
}

/**
 * 计算辅助关键词命中数。
 */
function countSecondaryHits(
  haystack: string,
  keys: string[],
  caseSensitive: boolean,
  matchWholeWords: boolean,
): number {
  return keys.filter((key) => matchKey(haystack, key, caseSensitive, matchWholeWords)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getEntryExtensionFlag(entry: STWorldBookEntry, key: string): boolean {
  const extensions = isRecord(entry.extra?.extensions) ? entry.extra.extensions : undefined;
  return extensions?.[key] === true;
}

function buildEntryHaystack(
  entry: STWorldBookEntry,
  context: TriggerContext,
  scanState: ScanState,
  recurseTexts: string[],
): string {
  return buildEntryHaystackSegments(entry, context, scanState, recurseTexts)
    .map((segment) => segment.text)
    .join('\n');
}

function buildEntryHaystackSegments(
  entry: STWorldBookEntry,
  context: TriggerContext,
  scanState: ScanState,
  recurseTexts: string[],
): HaystackSegment[] {
  const depth = Math.max(0, entry.scanDepth ?? context.scanDepth);
  if (depth === 0) {
    return [];
  }

  const segments: HaystackSegment[] = context.messages
    .slice(0, depth)
    .map((text, index) => ({ kind: 'message' as const, text, messageIndexFromLatest: index }))
    .filter((segment) => segment.text.length > 0);

  const scanSources = context.scanSources;
  if (scanSources) {
    if (getEntryExtensionFlag(entry, 'match_persona_description') && scanSources.personaDescription?.trim()) {
      segments.push({ kind: 'persona_description', text: scanSources.personaDescription.trim() });
    }
    if (getEntryExtensionFlag(entry, 'match_character_description') && scanSources.characterDescription?.trim()) {
      segments.push({ kind: 'character_description', text: scanSources.characterDescription.trim() });
    }
    if (getEntryExtensionFlag(entry, 'match_character_personality') && scanSources.characterPersonality?.trim()) {
      segments.push({ kind: 'character_personality', text: scanSources.characterPersonality.trim() });
    }
    if (getEntryExtensionFlag(entry, 'match_character_depth_prompt') && scanSources.characterDepthPrompt?.trim()) {
      segments.push({ kind: 'character_depth_prompt', text: scanSources.characterDepthPrompt.trim() });
    }
    if (getEntryExtensionFlag(entry, 'match_scenario') && scanSources.scenario?.trim()) {
      segments.push({ kind: 'scenario', text: scanSources.scenario.trim() });
    }
    if (getEntryExtensionFlag(entry, 'match_creator_notes') && scanSources.creatorNotes?.trim()) {
      segments.push({ kind: 'creator_notes', text: scanSources.creatorNotes.trim() });
    }
    if (Array.isArray(scanSources.injections) && scanSources.injections.length > 0) {
      scanSources.injections.forEach((text, injectionIndex) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return;
        }
        segments.push({ kind: 'injection', text: trimmed, injectionIndex });
      });
    }
  }

  if (scanState === 'RECURSION' && recurseTexts.length > 0) {
    for (const text of recurseTexts) {
      if (!text) {
        continue;
      }
      segments.push({ kind: 'recursion_buffer', text });
    }
  }

  return segments;
}

function shouldSkipEntryForScanState(
  entry: STWorldBookEntry,
  scanState: ScanState,
  recursionLevel: number,
): boolean {
  const requiredLevel = entry.delayUntilRecursion ?? null;

  if (scanState === 'INITIAL' && requiredLevel !== null) {
    return true;
  }

  if (scanState === 'RECURSION') {
    if (entry.excludeRecursion) {
      return true;
    }

    if (requiredLevel !== null && recursionLevel < requiredLevel) {
      return true;
    }
  }

  return false;
}

function getMaxDelayUntilRecursion(entries: STWorldBookEntry[]): number {
  return entries.reduce((max, entry) => {
    const value = entry.delayUntilRecursion ?? null;
    return value !== null && value > max ? value : max;
  }, 0);
}

function collectKeyMatchTraces(
  segments: HaystackSegment[],
  keys: string[],
  matchedKeyScope: 'primary' | 'secondary',
  caseSensitive: boolean,
  matchWholeWords: boolean,
): MatchTrace[] {
  const traces: MatchTrace[] = [];

  for (const key of keys) {
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]!;
      const match = matchKeyWithTrace(segment.text, key, caseSensitive, matchWholeWords);
      if (!match) {
        continue;
      }

      traces.push({
        ...match,
        matchedKey: key,
        matchedKeyScope,
        segmentIndex,
      });
      break;
    }
  }

  return traces;
}

function selectFirstMatchTrace(traces: MatchTrace[]): MatchTrace | null {
  if (traces.length === 0) {
    return null;
  }

  return [...traces].sort(compareMatchTrace)[0] ?? null;
}

function toTriggerFirstMatch(trace: MatchTrace, segment: HaystackSegment): TriggerFirstMatch {
  return {
    sourceKind: segment.kind,
    matchedKey: trace.matchedKey,
    matchedKeyScope: trace.matchedKeyScope,
    matchedKeyType: trace.matchedKeyType,
    charStart: trace.charStart,
    charEnd: trace.charEnd,
    excerpt: buildExcerpt(segment.text, trace.charStart, trace.charEnd),
    ...(segment.messageIndexFromLatest !== undefined
      ? { messageIndexFromLatest: segment.messageIndexFromLatest }
      : {}),
    ...(segment.injectionIndex !== undefined ? { injectionIndex: segment.injectionIndex } : {}),
  };
}

function buildActivationTrace(
  entry: STWorldBookEntry,
  context: TriggerContext,
  scanState: ScanState,
  recursionLevel: number,
  recurseTexts: string[],
): ActivationTrace | null {
  if (entry.constant) {
    return {
      mode: 'constant',
      recursionLevel,
      firstMatch: null,
    };
  }

  if (entry.key.length === 0) {
    return null;
  }

  const caseSensitive = entry.caseSensitive ?? context.caseSensitive;
  const matchWholeWords = entry.matchWholeWords ?? context.matchWholeWords;
  const segments = buildEntryHaystackSegments(entry, context, scanState, recurseTexts);
  const primaryMatchTraces = collectKeyMatchTraces(
    segments,
    entry.key,
    'primary',
    caseSensitive,
    matchWholeWords,
  );

  if (primaryMatchTraces.length === 0) {
    return null;
  }

  if (!entry.selective || entry.keysecondary.length === 0) {
    const firstMatchTrace = selectFirstMatchTrace(primaryMatchTraces);
    return {
      mode: 'triggered',
      recursionLevel,
      firstMatch: firstMatchTrace ? toTriggerFirstMatch(firstMatchTrace, segments[firstMatchTrace.segmentIndex]!) : null,
    };
  }

  const secondaryMatchTraces = collectKeyMatchTraces(
    segments,
    entry.keysecondary,
    'secondary',
    caseSensitive,
    matchWholeWords,
  );
  const secondaryHitCount = secondaryMatchTraces.length;
  const secondaryCount = entry.keysecondary.length;

  let triggered = false;
  switch (entry.selectiveLogic) {
    case WI_LOGIC.AND_ANY:
      triggered = secondaryHitCount > 0;
      break;
    case WI_LOGIC.AND_ALL:
      triggered = secondaryHitCount === secondaryCount;
      break;
    case WI_LOGIC.NOT_ANY:
      triggered = secondaryHitCount === 0;
      break;
    case WI_LOGIC.NOT_ALL:
      triggered = secondaryHitCount < secondaryCount;
      break;
    default:
      triggered = true;
      break;
  }

  if (!triggered) {
    return null;
  }

  const firstMatchTrace = selectFirstMatchTrace([...primaryMatchTraces, ...secondaryMatchTraces]);
  return {
    mode: 'triggered',
    recursionLevel,
    firstMatch: firstMatchTrace ? toTriggerFirstMatch(firstMatchTrace, segments[firstMatchTrace.segmentIndex]!) : null,
  };
}

/**
 * 检查条目是否被触发（综合 selective + selectiveLogic）。
 */
function isEntryTriggered(
  entry: STWorldBookEntry,
  haystack: string,
  globalCaseSensitive: boolean,
  globalMatchWholeWords: boolean,
): boolean {
  // constant 条目始终激活
  if (entry.constant) return true;

  // 没有主关键词 → 不触发
  if (entry.key.length === 0) return false;

  const caseSensitive = entry.caseSensitive ?? globalCaseSensitive;
  const matchWholeWords = entry.matchWholeWords ?? globalMatchWholeWords;

  // 主关键词：至少一个命中
  const primaryHit = matchAnyKey(haystack, entry.key, caseSensitive, matchWholeWords);
  if (!primaryHit) return false;

  // 非 selective 模式 → 只需主关键词
  if (!entry.selective || entry.keysecondary.length === 0) return true;

  // selective 模式 → 按 selectiveLogic 检查辅助关键词
  const secondaryCount = entry.keysecondary.length;
  const secondaryHits = countSecondaryHits(haystack, entry.keysecondary, caseSensitive, matchWholeWords);

  switch (entry.selectiveLogic) {
    case WI_LOGIC.AND_ANY:
      // 至少一个辅助关键词命中
      return secondaryHits > 0;

    case WI_LOGIC.AND_ALL:
      // 所有辅助关键词都命中
      return secondaryHits === secondaryCount;

    case WI_LOGIC.NOT_ANY:
      // 没有辅助关键词命中
      return secondaryHits === 0;

    case WI_LOGIC.NOT_ALL:
      // 不是所有辅助关键词都命中
      return secondaryHits < secondaryCount;

    default:
      return true;
  }
}

function readTriggerExtensions(entry: STWorldBookEntry): WorldbookTriggerExtensions {
  const path = `/entries/${entry.uid}/extra/extensions`;
  const value = entry.extra?.extensions;
  if (value !== undefined && !isRecord(value))
    throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_INPUT_INVALID', path);
  const parsed = worldbookTriggerExtensionsSchema.safeParse(value ?? {});
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join('/') ?? '';
    throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_INPUT_INVALID', field ? `${path}/${field}` : path);
  }
  return parsed.data;
}

function entryGroups(extension: WorldbookTriggerExtensions): string[] {
  return extension.group?.split(/,\s*/).map((name) => name.trim()).filter(Boolean) ?? [];
}

interface TriggerCandidate {
  entry: STWorldBookEntry;
  extension: WorldbookTriggerExtensions;
  state: TriggerBookState;
}

interface TriggerBookState extends TriggerBookInput {
  intent: PromptRunIntent;
  extensions: Map<number, WorldbookTriggerExtensions>;
  activated: Map<number, STWorldBookEntry>;
  activationTraces?: Map<number, ActivationTrace>;
  decisionTraces?: TriggerDecisionTrace[];
  failedProbabilityChecks: Set<number>;
  recurseTexts: string[];
  maxDelayLevel: number;
  loopCount: number;
  done: boolean;
}

function chooseGroupedEntries(
  candidates: TriggerCandidate[],
  activated: TriggerCandidate[],
  draw: () => number,
): TriggerCandidate[] {
  const selected = new Set(candidates);
  const groups = new Map<string, TriggerCandidate[]>();
  for (const candidate of candidates) {
    for (const name of entryGroups(candidate.extension)) {
      const members = groups.get(name) ?? [];
      members.push(candidate);
      groups.set(name, members);
    }
  }

  for (const [name, originalMembers] of groups) {
    const members = originalMembers.filter((candidate) => selected.has(candidate));
    if (members.length === 0) continue;
    const priorWinner = activated.some((candidate) => entryGroups(candidate.extension).includes(name));
    if (priorWinner) {
      for (const candidate of members) {
        selected.delete(candidate);
        candidate.state.decisionTraces?.push({ uid: candidate.entry.uid, stage: 'group', outcome: 'excluded', group: name });
      }
      continue;
    }
    if (members.length === 1) continue;

    const overrides = members.filter((candidate) => candidate.extension.group_override === true);
    let winner: TriggerCandidate;
    let randomDraw: number | undefined;
    if (overrides.length > 0) {
      winner = overrides[0]!;
    } else {
      const totalWeight = members.reduce((sum, candidate) => sum + (candidate.extension.group_weight ?? 100), 0);
      if (!Number.isFinite(totalWeight))
        throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_INPUT_INVALID', `/groups/${name}/group_weight`);
      randomDraw = draw();
      const threshold = randomDraw * totalWeight;
      let cumulative = 0;
      winner = members[members.length - 1]!;
      for (const candidate of members) {
        cumulative += candidate.extension.group_weight ?? 100;
        if (threshold <= cumulative) {
          winner = candidate;
          break;
        }
      }
    }
    for (const candidate of members) {
      const outcome = candidate === winner ? 'selected' : 'excluded';
      if (outcome === 'excluded') selected.delete(candidate);
      candidate.state.decisionTraces?.push({ uid: candidate.entry.uid, stage: 'group', outcome, group: name, ...(randomDraw === undefined ? {} : { randomDraw }) });
    }
  }
  return candidates.filter((candidate) => selected.has(candidate));
}

// ── 主函数 ────────────────────────────────────────────

/**
 * 世界书触发引擎：根据聊天消息扫描世界书条目，返回被触发的条目。
 *
 * @param entries - 世界书条目列表（应包含所有条目，包括 disabled 的）
 * @param context - 扫描上下文
 * @returns 触发结果（按 position 分类）
 */
export function triggerWorldBook(
  entries: STWorldBookEntry[],
  context: TriggerContext,
  dependencies: TriggerDependencies = {},
): TriggerResult {
  return triggerWorldBooks([{ entries, context }], dependencies)[0]!;
}

/** 按输入顺序返回各世界书结果；同一轮命中的所有世界书条目共同参与分组选择。 */
export function triggerWorldBooks(
  books: TriggerBookInput[],
  dependencies: TriggerDependencies = {},
): TriggerResult[] {
  if (dependencies.nextRandom !== undefined && typeof dependencies.nextRandom !== 'function')
    throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_RANDOM_INVALID', '/nextRandom');
  const draw = (): number => {
    let value: number;
    try {
      value = (dependencies.nextRandom ?? Math.random)();
    } catch {
      throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_RANDOM_INVALID', '/nextRandom');
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1)
      throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_RANDOM_INVALID', '/nextRandom');
    return value;
  };
  const states: TriggerBookState[] = books.map(({ entries, context }) => {
    const parsedIntent = worldbookRunIntentSchema.safeParse(context.intent === undefined ? 'normal' : context.intent);
    if (!parsedIntent.success)
      throw new WorldbookTriggerError('WORLDBOOK_TRIGGER_INPUT_INVALID', '/intent');
    const traceEnabled = context.traceEnabled === true;
    return {
      entries,
      context,
      intent: parsedIntent.data,
      extensions: new Map(entries.filter((entry) => !entry.disable).map((entry) => [entry.uid, readTriggerExtensions(entry)])),
      activated: new Map<number, STWorldBookEntry>(),
      ...(traceEnabled ? { activationTraces: new Map<number, ActivationTrace>(), decisionTraces: [] as TriggerDecisionTrace[] } : {}),
      failedProbabilityChecks: new Set<number>(),
      recurseTexts: [],
      maxDelayLevel: getMaxDelayUntilRecursion(entries),
      loopCount: 0,
      done: false,
    };
  });
  const allActivated: TriggerCandidate[] = [];

  while (states.some((state) => !state.done)) {
    const candidates: TriggerCandidate[] = [];
    for (const state of states) {
      if (state.done) continue;
      const { entries, context, loopCount, recurseTexts } = state;
      const maxRecursionSteps = context.maxRecursionSteps ?? 0;
      if (maxRecursionSteps > 0 && loopCount >= maxRecursionSteps) {
        state.done = true;
        continue;
      }

      const scanState: ScanState = loopCount === 0 ? 'INITIAL' : 'RECURSION';
      const recursionLevel = scanState === 'RECURSION' ? loopCount : 0;
      for (const entry of entries) {
        if (entry.disable || state.activated.has(entry.uid) || state.failedProbabilityChecks.has(entry.uid)) continue;
        const extension = state.extensions.get(entry.uid)!;
        if (extension.triggers?.length && !extension.triggers.includes(state.intent)) {
          state.decisionTraces?.push({ uid: entry.uid, stage: 'trigger', outcome: 'excluded', intent: state.intent });
          continue;
        }
        if (extension.delay && context.messages.length < extension.delay) {
          state.decisionTraces?.push({ uid: entry.uid, stage: 'delay', outcome: 'excluded', messageCount: context.messages.length, delay: extension.delay });
          continue;
        }
        if (shouldSkipEntryForScanState(entry, scanState, recursionLevel)) continue;

        if (state.activationTraces) {
          const activationTrace = buildActivationTrace(entry, context, scanState, recursionLevel, recurseTexts);
          if (!activationTrace) continue;
          state.activationTraces.set(entry.uid, activationTrace);
        } else {
          const haystack = buildEntryHaystack(entry, context, scanState, recurseTexts);
          if (!isEntryTriggered(entry, haystack, context.caseSensitive, context.matchWholeWords)) continue;
        }
        candidates.push({ entry, extension, state });
      }
    }

    candidates.sort((left, right) => right.entry.order - left.entry.order);
    const groupSelected = chooseGroupedEntries(candidates, allActivated, draw);
    const accepted: TriggerCandidate[] = [];
    for (const candidate of groupSelected) {
      const { entry, extension, state } = candidate;
      const probability = extension.probability ?? 100;
      if (extension.useProbability === false || probability === 100) {
        accepted.push(candidate);
        continue;
      }
      const randomDraw = draw();
      const passed = randomDraw * 100 <= probability;
      state.decisionTraces?.push({ uid: entry.uid, stage: 'probability', outcome: passed ? 'selected' : 'excluded', probability, randomDraw });
      if (passed) accepted.push(candidate);
      else state.failedProbabilityChecks.add(entry.uid);
    }
    const acceptedSet = new Set(accepted);
    for (const candidate of candidates) {
      if (!acceptedSet.has(candidate)) candidate.state.activationTraces?.delete(candidate.entry.uid);
    }

    for (const state of states) {
      if (state.done) continue;
      const stateAccepted = accepted.filter((candidate) => candidate.state === state);
      const recursive = state.context.recursive ?? false;
      const nextRecursionLevel = state.loopCount + 1;
      if (stateAccepted.length === 0) {
        if (recursive && nextRecursionLevel <= state.maxDelayLevel) state.loopCount = nextRecursionLevel;
        else state.done = true;
        continue;
      }
      for (const candidate of stateAccepted) state.activated.set(candidate.entry.uid, candidate.entry);
      allActivated.push(...stateAccepted);
      if (!recursive) {
        state.done = true;
        continue;
      }
      const nextRecurseTexts = stateAccepted
        .filter((candidate) => !candidate.entry.preventRecursion)
        .map((candidate) => candidate.entry.content)
        .filter((content) => typeof content === 'string' && content.trim().length > 0);
      state.recurseTexts.push(...nextRecurseTexts);
      if (nextRecurseTexts.length === 0 && nextRecursionLevel > state.maxDelayLevel) state.done = true;
      else state.loopCount = nextRecursionLevel;
    }
  }

  return states.map(buildTriggerResult);
}

function buildTriggerResult(state: TriggerBookState): TriggerResult {
  const activated = [...state.activated.values()].sort((a, b) => b.order - a.order);

  // 按 position 分类
  const before: STWorldBookEntry[] = [];
  const after: STWorldBookEntry[] = [];
  const atDepth: DepthEntry[] = [];
  const outletEntries: Record<string, STWorldBookEntry[]> = {};
  const anTop: STWorldBookEntry[] = [];
  const anBottom: STWorldBookEntry[] = [];
  const emTop: STWorldBookEntry[] = [];
  const emBottom: STWorldBookEntry[] = [];

  for (const entry of activated) {
    switch (entry.position) {
      case WI_POSITION.BEFORE:
        before.push(entry);
        break;
      case WI_POSITION.AFTER:
        after.push(entry);
        break;
      case WI_POSITION.AT_DEPTH:
        atDepth.push({ entry, depth: entry.depth, role: entry.role });
        break;
      case WI_POSITION.AN_TOP:
        anTop.push(entry);
        break;
      case WI_POSITION.AN_BOTTOM:
        anBottom.push(entry);
        break;
      case WI_POSITION.EM_TOP:
        emTop.push(entry);
        break;
      case WI_POSITION.EM_BOTTOM:
        emBottom.push(entry);
        break;
      case WI_POSITION.OUTLET: {
        const outletName = entry.outletName?.trim();
        if (!outletName) {
          break;
        }

        if (!outletEntries[outletName]) {
          outletEntries[outletName] = [];
        }
        outletEntries[outletName].push(entry);
        break;
      }
    }
  }

  return {
    activated,
    before,
    after,
    atDepth,
    anTop,
    anBottom,
    emTop,
    emBottom,
    outletEntries,
    ...(state.activationTraces ? { activationTraces: state.activationTraces } : {}),
    ...(state.decisionTraces ? { decisionTraces: state.decisionTraces } : {}),
  };
}
