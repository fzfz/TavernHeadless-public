import { describe, it, expect } from 'vitest';
import { triggerWorldBook, triggerWorldBooks, WorldbookTriggerError, type TriggerContext } from '../worldbook/trigger-engine.js';
import type { STWorldBookEntry } from '../types/worldbook.js';
import { WI_LOGIC, WI_POSITION, WI_ROLE } from '../types/worldbook.js';

/** Helper to create a minimal entry */
function makeEntry(overrides: Partial<STWorldBookEntry> & { uid: number }): STWorldBookEntry {
  return {
    key: [],
    keysecondary: [],
    selective: false,
    selectiveLogic: WI_LOGIC.AND_ANY,
    constant: false,
    content: '',
    comment: '',
    position: WI_POSITION.BEFORE,
    order: 100,
    depth: 4,
    role: WI_ROLE.SYSTEM,
    disable: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    ...overrides,
  };
}

const defaultContext: TriggerContext = {
  messages: ['Hello Alice', 'Bob is here', 'The dragon breathes fire'],
  scanDepth: 10,
  caseSensitive: false,
  matchWholeWords: false,
};

describe('triggerWorldBook', () => {
  describe('runtime extension selection', () => {
    const extensionEntry = (uid: number, extensions: Record<string, unknown>, order = 100) =>
      makeEntry({ uid, constant: true, order, content: String(uid), extra: { extensions } });

    it('filters even constant entries by the actual generation action', () => {
      const entries = [extensionEntry(1, { triggers: ['swipe'] }), extensionEntry(2, { triggers: [] })];
      const normal = triggerWorldBook(entries, { ...defaultContext, intent: 'normal', traceEnabled: true });
      expect(normal.activated.map((entry) => entry.uid)).toEqual([2]);
      expect(normal.decisionTraces).toContainEqual({ uid: 1, stage: 'trigger', outcome: 'excluded', intent: 'normal' });
      expect(triggerWorldBook(entries, { ...defaultContext, intent: 'swipe' }).activated.map((entry) => entry.uid)).toEqual([1, 2]);
      expect(triggerWorldBook(entries, { ...defaultContext, intent: 'regenerate' }).activated.map((entry) => entry.uid)).toEqual([2]);
    });

    it('uses the full message count for delay before constant activation', () => {
      const entries = [extensionEntry(1, { delay: 1 }), extensionEntry(2, { delay: null })];
      const empty = triggerWorldBook(entries, { ...defaultContext, messages: [], traceEnabled: true });
      expect(empty.activated.map((entry) => entry.uid)).toEqual([2]);
      expect(empty.decisionTraces).toContainEqual({ uid: 1, stage: 'delay', outcome: 'excluded', messageCount: 0, delay: 1 });
      expect(triggerWorldBook(entries, { ...defaultContext, messages: ['user input'] }).activated.map((entry) => entry.uid)).toEqual([1, 2]);
    });

    it('chooses one weighted group candidate and includes the boundary in the earlier weight', () => {
      const entries = [extensionEntry(1, { group: 'scene', group_weight: 1 }), extensionEntry(2, { group: 'scene', group_weight: 3 })];
      const first = triggerWorldBook(entries, { ...defaultContext, traceEnabled: true }, { nextRandom: () => 0.25 });
      expect(first.activated.map((entry) => entry.uid)).toEqual([1]);
      expect(first.decisionTraces).toContainEqual({ uid: 2, stage: 'group', outcome: 'excluded', group: 'scene', randomDraw: 0.25 });
      const second = triggerWorldBook(entries, defaultContext, { nextRandom: () => 0.250001 });
      expect(second.activated.map((entry) => entry.uid)).toEqual([2]);
    });

    it('honors group override priority without drawing a random winner', () => {
      const entries = [
        extensionEntry(1, { group: 'scene', group_override: true }, 200),
        extensionEntry(2, { group: 'scene', group_override: true }, 100),
      ];
      const noDraw = () => { throw new Error('random draw not expected'); };
      expect(triggerWorldBook(entries, defaultContext, { nextRandom: noDraw }).activated.map((entry) => entry.uid)).toEqual([1]);
    });

    it('keeps an activated group winner when another member matches during recursion', () => {
      const entries = [
        extensionEntry(1, { group: 'scene' }),
        makeEntry({ uid: 2, key: ['later'], content: 'late', extra: { extensions: { group: 'scene' } } }),
      ];
      entries[0]!.content = 'later';
      const result = triggerWorldBook(entries, {
        ...defaultContext,
        messages: ['unrelated'],
        recursive: true,
        maxRecursionSteps: 2,
        traceEnabled: true,
      });
      expect(result.activated.map((entry) => entry.uid)).toEqual([1]);
      expect(result.decisionTraces).toContainEqual({ uid: 2, stage: 'group', outcome: 'excluded', group: 'scene' });
    });

    it('chooses a group winner before probability and does not retry a losing group member', () => {
      const entries = [extensionEntry(1, { group: 'scene', probability: 100 }), extensionEntry(2, { group: 'scene', probability: 10 })];
      const draws = [0.75, 0.5];
      const result = triggerWorldBook(entries, { ...defaultContext, traceEnabled: true }, { nextRandom: () => draws.shift()! });
      expect(result.activated).toEqual([]);
      expect(draws).toEqual([]);
      expect(result.decisionTraces).toContainEqual({ uid: 2, stage: 'group', outcome: 'selected', group: 'scene', randomDraw: 0.75 });
      expect(result.decisionTraces).toContainEqual({ uid: 2, stage: 'probability', outcome: 'excluded', probability: 10, randomDraw: 0.5 });
      expect(result.activationTraces?.size).toBe(0);
    });

    it('arbitrates one group across books with overlapping entry uids before probability', () => {
      const first = extensionEntry(7, { group: 'scene', group_weight: 1, probability: 100 });
      const second = extensionEntry(7, { group: 'scene', group_weight: 3, probability: 10 });
      const draws = [0.75, 0.5];
      const results = triggerWorldBooks([
        { entries: [first], context: { ...defaultContext, traceEnabled: true } },
        { entries: [second], context: { ...defaultContext, traceEnabled: true } },
      ], { nextRandom: () => draws.shift()! });

      expect(results.map((result) => result.activated)).toEqual([[], []]);
      expect(draws).toEqual([]);
      expect(results[0]?.decisionTraces).toContainEqual({ uid: 7, stage: 'group', outcome: 'excluded', group: 'scene', randomDraw: 0.75 });
      expect(results[1]?.decisionTraces).toContainEqual({ uid: 7, stage: 'group', outcome: 'selected', group: 'scene', randomDraw: 0.75 });
      expect(results[1]?.decisionTraces).toContainEqual({ uid: 7, stage: 'probability', outcome: 'excluded', probability: 10, randomDraw: 0.5 });
      expect(results[0]?.activationTraces?.size).toBe(0);
      expect(results[1]?.activationTraces?.size).toBe(0);
    });

    it('preserves each book scan depth and recursion settings during global group selection', () => {
      const books = [
        {
          entries: [makeEntry({ uid: 1, key: ['old'], content: 'old', extra: { extensions: { group: 'scene' } } })],
          context: { ...defaultContext, messages: ['current', 'old'], scanDepth: 1, recursive: false },
        },
        {
          entries: [makeEntry({ uid: 1, key: ['old'], content: 'old', extra: { extensions: { group: 'scene' } } })],
          context: { ...defaultContext, messages: ['current', 'old'], scanDepth: 2, recursive: false },
        },
        {
          entries: [makeEntry({ uid: 1, constant: true, content: 'hidden' }), makeEntry({ uid: 2, key: ['hidden'], content: 'recursive result' })],
          context: { ...defaultContext, messages: ['current'], recursive: true, maxRecursionSteps: 2 },
        },
        {
          entries: [makeEntry({ uid: 1, constant: true, content: 'hidden' }), makeEntry({ uid: 2, key: ['hidden'], content: 'nonrecursive result' })],
          context: { ...defaultContext, messages: ['current'], recursive: false },
        },
      ];
      const results = triggerWorldBooks(books);
      expect(results.map((result) => result.activated.map((entry) => entry.uid))).toEqual([[], [1], [1, 2], [1]]);
    });

    it('checks probability at zero, the exact threshold, and the default pass cases', () => {
      const zero = extensionEntry(1, { probability: 0 });
      expect(triggerWorldBook([zero], defaultContext, { nextRandom: () => 0.01 }).activated).toEqual([]);
      expect(triggerWorldBook([zero], defaultContext, { nextRandom: () => 0 }).activated.map((entry) => entry.uid)).toEqual([1]);
      const threshold = extensionEntry(2, { probability: 50 });
      expect(triggerWorldBook([threshold], defaultContext, { nextRandom: () => 0.5 }).activated.map((entry) => entry.uid)).toEqual([2]);
      expect(triggerWorldBook([threshold], defaultContext, { nextRandom: () => 0.500001 }).activated).toEqual([]);
      const noDraw = () => { throw new Error('random draw not expected'); };
      expect(triggerWorldBook([extensionEntry(3, { probability: 1, useProbability: false }), extensionEntry(4, { probability: 100 })], defaultContext, { nextRandom: noDraw }).activated.map((entry) => entry.uid)).toEqual([3, 4]);
    });

    it.each([
      [{ probability: -1 }, '/probability'],
      [{ probability: 101 }, '/probability'],
      [{ probability: Number.NaN }, '/probability'],
      [{ group: 'scene', group_weight: -1 }, '/group_weight'],
      [{ group: 'scene', group_weight: Number.POSITIVE_INFINITY }, '/group_weight'],
      [{ triggers: ['unknown'] }, '/triggers/0'],
    ])('rejects invalid extension %j with its field path', (extension, suffix) => {
      expect(() => triggerWorldBook([extensionEntry(1, extension)], defaultContext)).toThrowError(WorldbookTriggerError);
      try {
        triggerWorldBook([extensionEntry(1, extension)], defaultContext);
      } catch (error) {
        expect(error).toMatchObject({ code: 'WORLDBOOK_TRIGGER_INPUT_INVALID', path: `/entries/1/extra/extensions${suffix}` });
      }
    });

    it.each([-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an out-of-range random draw %s', (value) => {
      const entry = extensionEntry(1, { probability: 50 });
      expect(() => triggerWorldBook([entry], defaultContext, { nextRandom: () => value })).toThrowError(WorldbookTriggerError);
      try {
        triggerWorldBook([entry], defaultContext, { nextRandom: () => value });
      } catch (error) {
        expect(error).toMatchObject({ code: 'WORLDBOOK_TRIGGER_RANDOM_INVALID', path: '/nextRandom' });
      }
    });

    it('rejects an invalid intent or random dependency before scanning', () => {
      const entry = extensionEntry(1, {});
      expect(() => triggerWorldBook([entry], { ...defaultContext, intent: 'other' as TriggerContext['intent'] })).toThrowError(WorldbookTriggerError);
      expect(() => triggerWorldBook([entry], defaultContext, { nextRandom: null as unknown as () => number })).toThrowError(WorldbookTriggerError);
      expect(() => triggerWorldBook([extensionEntry(2, { probability: 50 })], defaultContext, { nextRandom: () => { throw new Error('offline'); } })).toThrowError(WorldbookTriggerError);
    });
  });
  describe('basic keyword matching', () => {
    it('triggers on simple keyword', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'Alice info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
      expect(result.activated[0]!.uid).toBe(0);
    });

    it('does not trigger when keyword not found', () => {
      const entries = [makeEntry({ uid: 0, key: ['Charlie'], content: 'Charlie info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(0);
    });

    it('triggers when any primary key matches', () => {
      const entries = [makeEntry({ uid: 0, key: ['Charlie', 'Alice'], content: 'info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
    });

    it('is case-insensitive by default', () => {
      const entries = [makeEntry({ uid: 0, key: ['alice'], content: 'info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
    });
  });

  describe('case sensitivity', () => {
    it('respects global caseSensitive', () => {
      const entries = [makeEntry({ uid: 0, key: ['alice'], content: 'info' })];
      const ctx = { ...defaultContext, caseSensitive: true };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(0);
    });

    it('entry caseSensitive overrides global', () => {
      const entries = [makeEntry({ uid: 0, key: ['alice'], content: 'info', caseSensitive: false })];
      const ctx = { ...defaultContext, caseSensitive: true };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(1);
    });
  });

  describe('whole word matching', () => {
    it('matches partial word when disabled', () => {
      const entries = [makeEntry({ uid: 0, key: ['Ali'], content: 'info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
    });

    it('rejects partial word when enabled', () => {
      const entries = [makeEntry({ uid: 0, key: ['Ali'], content: 'info' })];
      const ctx = { ...defaultContext, matchWholeWords: true };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(0);
    });

    it('matches whole word when enabled', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'info' })];
      const ctx = { ...defaultContext, matchWholeWords: true };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(1);
    });
  });

  describe('regex keyword', () => {
    it('triggers on regex pattern', () => {
      const entries = [makeEntry({ uid: 0, key: ['/drag[o0]n/i'], content: 'dragon info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
    });

    it('does not trigger on non-matching regex', () => {
      const entries = [makeEntry({ uid: 0, key: ['/unicorn/i'], content: 'info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(0);
    });
  });

  describe('constant entries', () => {
    it('always activates constant entries', () => {
      const entries = [makeEntry({ uid: 0, key: [], constant: true, content: 'always on' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(1);
    });
  });

  describe('disabled entries', () => {
    it('skips disabled entries', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'info', disable: true })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(0);
    });
  });

  describe('selective logic', () => {
    const baseEntry = {
      uid: 0,
      key: ['Alice'],
      keysecondary: ['mage', 'wizard'],
      selective: true,
      content: 'info',
    };

    it('AND_ANY: triggers when at least one secondary key matches', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.AND_ANY })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(1);
    });

    it('AND_ANY: does not trigger when no secondary key matches', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a knight'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.AND_ANY })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(0);
    });

    it('AND_ALL: triggers when all secondary keys match', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage and wizard'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.AND_ALL })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(1);
    });

    it('AND_ALL: does not trigger when only some secondary keys match', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.AND_ALL })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(0);
    });

    it('NOT_ANY: triggers when no secondary key matches', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a knight'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.NOT_ANY })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(1);
    });

    it('NOT_ANY: does not trigger when any secondary key matches', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.NOT_ANY })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(0);
    });

    it('NOT_ALL: triggers when not all secondary keys match', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.NOT_ALL })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(1);
    });

    it('NOT_ALL: does not trigger when all secondary keys match', () => {
      const ctx: TriggerContext = {
        messages: ['Alice is a mage and wizard'],
        scanDepth: 10,
        caseSensitive: false,
        matchWholeWords: false,
      };
      const entries = [makeEntry({ ...baseEntry, selectiveLogic: WI_LOGIC.NOT_ALL })];
      expect(triggerWorldBook(entries, ctx).activated).toHaveLength(0);
    });
  });

  describe('scanDepth', () => {
    it('respects global scanDepth', () => {
      const entries = [makeEntry({ uid: 0, key: ['dragon'], content: 'info' })];
      // dragon is in messages[2], scanDepth=1 only scans messages[0]
      const ctx = { ...defaultContext, scanDepth: 1 };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(0);
    });

    it('respects entry-level scanDepth', () => {
      const entries = [makeEntry({ uid: 0, key: ['dragon'], content: 'info', scanDepth: 1 })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(0);
    });

    it('entry scanDepth overrides global', () => {
      const entries = [makeEntry({ uid: 0, key: ['dragon'], content: 'info', scanDepth: 10 })];
      const ctx = { ...defaultContext, scanDepth: 1 };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(1);
    });
  });

  describe('recursive scanning', () => {
    it('activates chained entries when recursive is enabled', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil', order: 100 }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore', order: 200 }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: true, maxRecursionSteps: 2 });
      expect(result.activated.map(entry => entry.uid)).toEqual([1, 0]);
    });

    it('does not recurse when recursive is disabled', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil' }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore' }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: false, maxRecursionSteps: 3 });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });

    it('respects maxRecursionSteps', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil' }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore' }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: true, maxRecursionSteps: 1 });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });

    it('prevents recursion when preventRecursion is enabled', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil', preventRecursion: true }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore' }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: true, maxRecursionSteps: 3 });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });

    it('skips recursion-only excluded entries during recursion rounds', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil' }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore', excludeRecursion: true }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: true, maxRecursionSteps: 3 });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });

    it('allows delayUntilRecursion entries to activate on later recursion scans', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'Delayed lore', delayUntilRecursion: 1 }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['dragon'], recursive: true, maxRecursionSteps: 2 });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });
  });

  describe('additional scan sources', () => {
    it('matches scenario when entry opt-in flag is enabled', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['observatory'], content: 'Scenario lore', extra: { extensions: { match_scenario: true } } }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['unrelated'], scanSources: { scenario: 'An observatory above the clouds.' } });
      expect(result.activated.map(entry => entry.uid)).toEqual([0]);
    });

    it('does not match scenario when entry opt-in flag is absent', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['observatory'], content: 'Scenario lore' }),
      ];

      const result = triggerWorldBook(entries, { ...defaultContext, messages: ['unrelated'], scanSources: { scenario: 'An observatory above the clouds.' } });
      expect(result.activated).toHaveLength(0);
    });
  });
  describe('trace mode', () => {
    it('does not return activation traces when traceEnabled is false', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'Alice info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activationTraces).toBeUndefined();
    });

    it('returns the first plain-text match from the latest message', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'Alice info' })];
      const result = triggerWorldBook(entries, { ...defaultContext, traceEnabled: true });
      expect(result.activationTraces?.get(0)).toEqual({
        mode: 'triggered',
        recursionLevel: 0,
        firstMatch: {
          sourceKind: 'message',
          messageIndexFromLatest: 0,
          matchedKey: 'Alice',
          matchedKeyScope: 'primary',
          matchedKeyType: 'plain',
          charStart: 6,
          charEnd: 11,
          excerpt: 'Hello Alice',
        },
      });
    });

    it('marks selective hits as secondary when the earliest activating match comes from a secondary key', () => {
      const entry = makeEntry({
        uid: 0,
        key: ['Alice'],
        keysecondary: ['mage'],
        selective: true,
        selectiveLogic: WI_LOGIC.AND_ANY,
        content: 'Alice lore',
      });
      const result = triggerWorldBook([entry], {
        ...defaultContext,
        messages: ['mage Alice'],
        traceEnabled: true,
      });

      expect(result.activationTraces?.get(0)?.firstMatch).toEqual({
        sourceKind: 'message',
        messageIndexFromLatest: 0,
        matchedKey: 'mage',
        matchedKeyScope: 'secondary',
        matchedKeyType: 'plain',
        charStart: 0,
        charEnd: 4,
        excerpt: 'mage Alice',
      });
    });

    it('returns recursion_buffer as the source kind for recursive activations', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['dragon'], content: 'phoenix sigil', order: 100 }),
        makeEntry({ uid: 1, key: ['phoenix'], content: 'Phoenix lore', order: 200 }),
      ];
      const result = triggerWorldBook(entries, {
        ...defaultContext,
        messages: ['dragon'],
        recursive: true,
        maxRecursionSteps: 2,
        traceEnabled: true,
      });

      expect(result.activationTraces?.get(1)).toEqual({
        mode: 'triggered',
        recursionLevel: 1,
        firstMatch: {
          sourceKind: 'recursion_buffer',
          matchedKey: 'phoenix',
          matchedKeyScope: 'primary',
          matchedKeyType: 'plain',
          charStart: 0,
          charEnd: 7,
          excerpt: 'phoenix sigil',
        },
      });
    });

    it('returns character depth prompt and injection scan source metadata', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['lantern'], content: 'Depth lore', extra: { extensions: { match_character_depth_prompt: true } } }),
        makeEntry({ uid: 1, key: ['oath'], content: 'Injection lore', extra: { extensions: { match_character_depth_prompt: false } } }),
      ];
      const result = triggerWorldBook(entries, {
        ...defaultContext,
        messages: ['unrelated'],
        traceEnabled: true,
        scanSources: {
          characterDepthPrompt: 'A lantern hangs above the doorway.',
          injections: ['oath of the watch'],
        },
      });

      expect(result.activationTraces?.get(0)?.firstMatch).toEqual({
        sourceKind: 'character_depth_prompt',
        matchedKey: 'lantern',
        matchedKeyScope: 'primary',
        matchedKeyType: 'plain',
        charStart: 2,
        charEnd: 9,
        excerpt: 'A lantern hangs above the doorway.',
      });
      expect(result.activationTraces?.get(1)?.firstMatch).toEqual({
        sourceKind: 'injection',
        injectionIndex: 0,
        matchedKey: 'oath',
        matchedKeyScope: 'primary',
        matchedKeyType: 'plain',
        charStart: 0,
        charEnd: 4,
        excerpt: 'oath of the watch',
      });
    });

    it('returns null firstMatch for constant entries', () => {
      const entries = [makeEntry({ uid: 0, key: [], constant: true, content: 'always on' })];
      const result = triggerWorldBook(entries, { ...defaultContext, traceEnabled: true });
      expect(result.activationTraces?.get(0)).toEqual({
        mode: 'constant',
        recursionLevel: 0,
        firstMatch: null,
      });
    });
  });



  describe('ordering', () => {
    it('sorts activated entries by order descending', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['Alice'], order: 50, content: 'low' }),
        makeEntry({ uid: 1, key: ['Bob'], order: 200, content: 'high' }),
        makeEntry({ uid: 2, key: ['dragon'], order: 100, content: 'mid' }),
      ];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated.map(e => e.uid)).toEqual([1, 2, 0]);
    });
  });

  describe('position classification', () => {
    it('classifies entries by position', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['Alice'], position: WI_POSITION.BEFORE, content: 'before' }),
        makeEntry({ uid: 1, key: ['Bob'], position: WI_POSITION.AFTER, content: 'after' }),
        makeEntry({ uid: 2, key: ['dragon'], position: WI_POSITION.AT_DEPTH, depth: 3, role: WI_ROLE.USER, content: 'depth' }),
      ];
      const result = triggerWorldBook(entries, defaultContext);

      expect(result.before).toHaveLength(1);
      expect(result.before[0]!.uid).toBe(0);

      expect(result.after).toHaveLength(1);
      expect(result.after[0]!.uid).toBe(1);

      expect(result.atDepth).toHaveLength(1);
      expect(result.atDepth[0]!.entry.uid).toBe(2);
      expect(result.atDepth[0]!.depth).toBe(3);
      expect(result.atDepth[0]!.role).toBe(WI_ROLE.USER);
    });

    it('keeps AN/EM positions in explicit buckets', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['Alice'], position: WI_POSITION.AN_TOP, content: 'an' }),
        makeEntry({ uid: 1, key: ['Bob'], position: WI_POSITION.EM_BOTTOM, content: 'em' }),
      ];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.after).toHaveLength(0);
      expect(result.anTop.map((entry) => entry.uid)).toEqual([0]);
      expect(result.anBottom).toHaveLength(0);
      expect(result.emTop).toHaveLength(0);
      expect(result.emBottom.map((entry) => entry.uid)).toEqual([1]);
    });

    it('keeps outlet positions out of the after bucket', () => {
      const entries = [
        makeEntry({ uid: 0, key: ['Alice'], position: WI_POSITION.OUTLET, content: 'outlet lore', outletName: 'LoreOutlet' }),
      ];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.after).toHaveLength(0);
      expect(result.outletEntries?.LoreOutlet).toHaveLength(1);
      expect(result.outletEntries?.LoreOutlet?.[0]?.uid).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty entries', () => {
      const result = triggerWorldBook([], defaultContext);
      expect(result.activated).toHaveLength(0);
    });

    it('handles empty messages', () => {
      const entries = [makeEntry({ uid: 0, key: ['Alice'], content: 'info' })];
      const ctx = { ...defaultContext, messages: [] };
      const result = triggerWorldBook(entries, ctx);
      expect(result.activated).toHaveLength(0);
    });

    it('handles entry with empty key array', () => {
      const entries = [makeEntry({ uid: 0, key: [], content: 'info' })];
      const result = triggerWorldBook(entries, defaultContext);
      expect(result.activated).toHaveLength(0);
    });
  });
});

it('allows a later group to exclude a candidate selected by an earlier group', () => {
  const entries = [
    makeEntry({ uid: 1, constant: true, extra: { extensions: { group: 'g1,g2' } } }),
    makeEntry({ uid: 2, constant: true, extra: { extensions: { group: 'g1' } } }),
    makeEntry({ uid: 3, constant: true, extra: { extensions: { group: 'g2' } } }),
  ];
  const draws = [0, 0.75];
  const result = triggerWorldBook(entries, { ...defaultContext, traceEnabled: true }, { nextRandom: () => draws.shift()! });
  expect(result.activated.map(entry => entry.uid)).toEqual([3]);
  expect(result.decisionTraces).toContainEqual(expect.objectContaining({ uid: 1, group: 'g1', outcome: 'selected' }));
  expect(result.decisionTraces).toContainEqual(expect.objectContaining({ uid: 1, group: 'g2', outcome: 'excluded' }));
});

it('skips disabled entries before validating runtime selection fields', () => {
  const entries = [
    makeEntry({ uid: 1, disable: true, extra: { extensions: { group_weight: -1 } } }),
    makeEntry({ uid: 2, constant: true }),
  ];
  expect(triggerWorldBook(entries, defaultContext).activated.map(entry => entry.uid)).toEqual([2]);
});
