import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { derive, eventOrder } from "../characters/linqian/derive.js";
import { validate } from "../characters/linqian/validate.js";

const characterDirectory = new URL("../characters/linqian/", import.meta.url);
const readJson = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, characterDirectory), "utf8"));
const profile = readJson("live-model.json");
const stateSchema = readJson("state.schema.json");
const constants = readJson("rules.constants.json");
const openings = readJson("opening-states.json");
const rules = readJson("update-rules.json");
const conversion = readJson("conversion-map.json");
const sourceCard = readJson("source-card.json").data;

const require = createRequire(
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/package.json",
);
const Ajv = require("./dist/ajv.js");
const ajv = new Ajv({ strict: true });
const validateStateSchema = ajv.compile(stateSchema);
const validateFactsSchema = ajv.compile(profile.factsSchema);

function neutralFacts(overrides = {}) {
  return {
    elapsedMinutes: 0,
    finalLocation: "拆迁旧楼408室内",
    completedA1Events: [],
    d001Completed: false,
    completedOneTimeEvents: [],
    relationship: {
      positiveDelta: 0,
      negativeDelta: 0,
      intimacyTier: "none",
    },
    corruptionSettlement: {
      settlementTriggered: false,
      specialStimulatorOnly: false,
      behaviors: [],
      resultTier: "none",
      materialAnomaly: false,
    },
    ending: {
      routeRulesLoaded: false,
      formedRoute: null,
      explicitReselection: false,
      divorceFormed: false,
      completedStage: null,
    },
    ...overrides,
  };
}

function state(name = "first") {
  return structuredClone(openings[name]);
}

function pointerSchema(schema, pointer) {
  return pointer
    .slice(1)
    .split("/")
    .reduce((node, part) => {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (node.type === "array")
        return Array.isArray(node.items) ? node.items[Number(key)] : node.items;
      return node.properties[key];
    }, schema);
}

function assertDescriptions(schema, path = "factsSchema") {
  assert.equal(
    typeof schema.description,
    "string",
    `${path} must have a description`,
  );
  assert(schema.description.trim(), `${path} description must be non-empty`);
  for (const [key, child] of Object.entries(schema.properties ?? {}))
    assertDescriptions(child, `${path}.${key}`);
  if (schema.items && typeof schema.items === "object")
    assertDescriptions(schema.items, `${path}.items`);
}

assert.equal(profile.stateSchemaFile, "state.schema.json");
assert.deepEqual(profile.ruleFiles, ["update-rules.json"]);
assert.equal(profile.deriveScript, "derive.js");
assert.equal(profile.validateScript, "validate.js");
assert.deepEqual(profile.moduleFiles, ["rules.constants.json"]);
assertDescriptions(profile.factsSchema);
assert.deepEqual(profile.writablePaths, ["/林茜/内心想法", "/行动选项"]);
for (const path of [...profile.writablePaths, ...profile.derivedPaths])
  assert(pointerSchema(stateSchema, path));
assert.deepEqual(
  profile.sourceAgentBindingIds,
  profile.followupAgents.map((agent) => agent.id),
);
assert.equal(profile.followupAgents.length, 2);

const worldSchema = stateSchema.properties.世界.properties;
assert.deepEqual(
  Object.keys(worldSchema.已触发事件.properties),
  constants.eventOrder,
);
assert.deepEqual(
  profile.factsSchema.properties.completedOneTimeEvents.items.enum,
  constants.eventOrder,
);
assert.deepEqual(
  new Set(worldSchema.星期.enum),
  new Set(constants.weekdaysByUtcDay),
);
assert.deepEqual(
  new Set(worldSchema.时间.enum),
  new Set(constants.periodByHour),
);
assert.deepEqual(
  worldSchema.终局路线.enum,
  Object.values(constants.routeValues),
);
assert.deepEqual(worldSchema.终局阶段.enum, constants.endingStageValues);
assert.deepEqual(
  profile.factsSchema.properties.relationship.properties.intimacyTier.enum,
  Object.keys(constants.relationship.intimacyTiers),
);
assert.equal(
  profile.factsSchema.properties.relationship.properties.positiveDelta.minimum,
  0,
);
assert.equal(
  profile.factsSchema.properties.relationship.properties.positiveDelta.maximum,
  constants.relationship.dailyPositiveMaximum,
);
assert.equal(
  profile.factsSchema.properties.relationship.properties.negativeDelta.minimum,
  constants.relationship.dailyMinimum,
);
assert.equal(
  profile.factsSchema.properties.relationship.properties.negativeDelta.maximum,
  0,
);
assert.deepEqual(
  profile.factsSchema.properties.corruptionSettlement.properties.behaviors.items
    .properties.tier.enum,
  Object.keys(constants.corruption.baseValues).filter(
    (tier) => tier !== "none",
  ),
);
assert.deepEqual(
  profile.factsSchema.properties.corruptionSettlement.properties.resultTier
    .enum,
  Object.keys(constants.corruption.resultValues),
);

for (const [openingId, expected] of Object.entries(openings)) {
  assert(
    validateStateSchema(expected),
    `${openingId}: ${ajv.errorsText(validateStateSchema.errors)}`,
  );
  const facts = neutralFacts({ finalLocation: expected.世界.地点 });
  assert.deepEqual(
    validate({ before: expected, candidate: expected, facts }).issues,
    [],
  );
}
assert.equal(openings.first.世界.日期, "2025-03-10");
assert.equal(openings["alternate-1"].世界.日期, "2025-04-04");
assert.equal(openings["alternate-1"].世界.地点, "局子街55号401画室");
assert.equal(openings["alternate-1"].林茜.感情, 694);

{
  const before = state();
  Object.assign(before.世界, {
    日期: "2025-03-10",
    星期: "周一",
    小时: 23,
    分钟: 59,
    时间: "深夜",
    状态_A1_日期: "2025-03-10",
    状态_A1_计数: 4,
  });
  const candidate = structuredClone(before);
  const facts = neutralFacts({
    elapsedMinutes: 2,
    finalLocation: "街口",
    completedA1Events: [
      { kind: "D002", completedDate: "2025-03-10" },
      { kind: "D003", completedDate: "2025-03-11" },
      { kind: "D003", completedDate: "2025-03-11" },
    ],
    d001Completed: true,
  });
  assert(
    validateFactsSchema(facts),
    ajv.errorsText(validateFactsSchema.errors),
  );
  const result = derive({ before, candidate, facts });
  assert.deepEqual(result.世界, {
    ...result.世界,
    日期: "2025-03-11",
    星期: "周二",
    小时: 0,
    分钟: 1,
    时间: "深夜",
    地点: "街口",
    状态_A1_日期: "2025-03-11",
    状态_A1_计数: 2,
    事件_D001记录日期: "2025-03-11",
  });
  assert.deepEqual(candidate, before, "derive must not mutate candidate");
  assert.deepEqual(validate({ before, candidate: result, facts }).issues, []);
}

{
  const before = state();
  before.林茜.感情 = "10000";
  before.林茜.堕落 = "-2";
  before.世界.小时 = "99";
  before.世界.分钟 = "-5";
  before.世界.状态_A1_计数 = "11";
  const result = derive({
    before,
    candidate: structuredClone(before),
    facts: neutralFacts(),
  });
  assert.equal(result.林茜.感情, 999);
  assert.equal(result.林茜.堕落, 0);
  assert.equal(result.世界.小时, 23);
  assert.equal(result.世界.分钟, 0);
  assert.equal(result.世界.状态_A1_计数, 9);
  const missing = state();
  delete missing.林茜.内心想法;
  const derivedMissing = derive({
    before: state(),
    candidate: missing,
    facts: neutralFacts(),
  });
  assert.equal(validateStateSchema(derivedMissing), false);
  assert(
    validate({
      before: state(),
      candidate: derivedMissing,
      facts: neutralFacts(),
    }).issues.some((item) => item.path === "/林茜/内心想法"),
  );
}

{
  const invalidLength = state();
  invalidLength.行动选项.pop();
  assert.equal(validateStateSchema(invalidLength), false);
  const invalidValues = state();
  invalidValues.行动选项 = ["短推进", "重复", "重复", "快速收束"];
  const codes = validate({
    before: state(),
    candidate: invalidValues,
    facts: neutralFacts(),
  }).issues.map((item) => item.code);
  assert(codes.includes("OPTIONS_DUPLICATED"));
  assert(codes.includes("OPTION_PREFIX_INVALID"));
}

{
  const before = state();
  const skipped = derive({
    before,
    candidate: structuredClone(before),
    facts: neutralFacts({ completedOneTimeEvents: ["事件_E002"] }),
  });
  assert.equal(skipped.世界.已触发事件.事件_E001, false);
  assert.equal(skipped.世界.已触发事件.事件_E002, false);
  const completed = derive({
    before,
    candidate: structuredClone(before),
    facts: neutralFacts({ completedOneTimeEvents: ["事件_E001", "事件_E002"] }),
  });
  assert.equal(completed.世界.已触发事件.事件_E001, true);
  assert.equal(completed.世界.已触发事件.事件_E002, true);
  assert.deepEqual(
    validate({
      before,
      candidate: completed,
      facts: neutralFacts({
        completedOneTimeEvents: ["事件_E001", "事件_E002"],
      }),
    }).issues,
    [],
  );
}

{
  const before = state();
  const unchanged = derive({
    before,
    candidate: structuredClone(before),
    facts: neutralFacts(),
  });
  assert.equal(unchanged.世界.终局阶段, "Z000");
  const completed = derive({
    before,
    candidate: structuredClone(before),
    facts: neutralFacts({
      ending: { ...neutralFacts().ending, completedStage: "Z001" },
    }),
  });
  assert.equal(completed.世界.终局阶段, "Z001");

  const locked = state();
  locked.世界.终局路线 = "结局一_离婚";
  locked.世界.终局阶段 = "Z001";
  locked.世界.已离婚 = true;
  const attempted = structuredClone(locked);
  attempted.世界.终局路线 = "结局二_三人共处";
  attempted.世界.终局阶段 = "Z000";
  attempted.世界.已离婚 = false;
  const kept = derive({
    before: locked,
    candidate: attempted,
    facts: neutralFacts({
      ending: {
        ...neutralFacts().ending,
        routeRulesLoaded: true,
        formedRoute: "结局二_三人共处",
      },
    }),
  });
  assert.equal(kept.世界.终局路线, "结局一_离婚");
  assert.equal(kept.世界.终局阶段, "Z001");
  assert.equal(kept.世界.已离婚, true);
  const reselected = derive({
    before: locked,
    candidate: structuredClone(locked),
    facts: neutralFacts({
      ending: {
        ...neutralFacts().ending,
        routeRulesLoaded: true,
        formedRoute: "结局二_三人共处",
        explicitReselection: true,
      },
    }),
  });
  assert.equal(reselected.世界.终局路线, "结局二_三人共处");
  const shared = derive({
    before: locked,
    candidate: structuredClone(locked),
    facts: neutralFacts({
      ending: { ...neutralFacts().ending, completedStage: "Z010_Z013" },
    }),
  });
  assert.equal(shared.世界.终局阶段, "Z010");
}

{
  const floorBefore = state();
  floorBefore.林茜.感情 = 100;
  floorBefore.林茜.堕落 = 20;
  const mainFacts = neutralFacts({
    relationship: {
      positiveDelta: 4,
      negativeDelta: 0,
      intimacyTier: "ordinary",
    },
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      settlementTriggered: true,
      behaviors: [{ tier: "touch", count: 1 }],
    },
  });
  const afterMain = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: mainFacts,
    priorFacts: [],
    floorBefore,
  });
  assert.equal(afterMain.林茜.感情, 105);
  assert.equal(afterMain.林茜.堕落, 30);
  const followupFacts = neutralFacts({
    relationship: {
      positiveDelta: 4,
      negativeDelta: 0,
      intimacyTier: "preferred",
    },
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      settlementTriggered: true,
      behaviors: [{ tier: "touch", count: 1 }],
      resultTier: "unprotected_internal",
    },
  });
  const afterFollowup = derive({
    before: afterMain,
    candidate: structuredClone(afterMain),
    facts: followupFacts,
    priorFacts: [mainFacts],
    floorBefore,
  });
  assert.equal(
    afterFollowup.林茜.感情,
    106.5,
    "daily total is capped at 5 and intimacy only adds the higher-tier difference",
  );
  assert.equal(
    afterFollowup.林茜.堕落,
    45,
    "the floor settles one aggregated base, repetition bonus and highest result",
  );
  assert.deepEqual(
    validate({
      before: afterMain,
      candidate: afterFollowup,
      facts: followupFacts,
      priorFacts: [mainFacts],
      floorBefore,
    }).issues,
    [],
  );
}

{
  const floorBefore = state();
  floorBefore.林茜.感情 = 0;
  const negative = neutralFacts({
    relationship: {
      positiveDelta: 0,
      negativeDelta: -1,
      intimacyTier: "none",
    },
  });
  const afterNegative = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: negative,
    priorFacts: [],
    floorBefore,
  });
  assert.equal(afterNegative.林茜.感情, 0);
  const positive = neutralFacts({
    relationship: {
      positiveDelta: 1,
      negativeDelta: 0,
      intimacyTier: "none",
    },
  });
  const afterPositive = derive({
    before: afterNegative,
    candidate: structuredClone(afterNegative),
    facts: positive,
    priorFacts: [negative],
    floorBefore,
  });
  assert.equal(
    afterPositive.林茜.感情,
    0,
    "the floor total is clamped after negative and positive facts are combined",
  );

  const mixed = neutralFacts({
    relationship: {
      positiveDelta: 5,
      negativeDelta: -1,
      intimacyTier: "none",
    },
  });
  const afterMixed = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: mixed,
    priorFacts: [],
    floorBefore,
  });
  assert.equal(afterMixed.林茜.感情, 4);
  const afterExtraPositive = derive({
    before: afterMixed,
    candidate: structuredClone(afterMixed),
    facts: positive,
    priorFacts: [mixed],
    floorBefore,
  });
  assert.equal(
    afterExtraPositive.林茜.感情,
    4,
    "positive and negative components remain separate when the positive cap is reached",
  );

  const highFloor = state();
  highFloor.林茜.感情 = 998;
  const highPositive = neutralFacts({
    relationship: {
      positiveDelta: 5,
      negativeDelta: 0,
      intimacyTier: "none",
    },
  });
  const afterHighPositive = derive({
    before: highFloor,
    candidate: structuredClone(highFloor),
    facts: highPositive,
    priorFacts: [],
    floorBefore: highFloor,
  });
  assert.equal(afterHighPositive.林茜.感情, 999);
  const afterHighNegative = derive({
    before: afterHighPositive,
    candidate: structuredClone(afterHighPositive),
    facts: negative,
    priorFacts: [highPositive],
    floorBefore: highFloor,
  });
  assert.equal(
    afterHighNegative.林茜.感情,
    999,
    "upper clamp is applied after the complete floor total",
  );
}

{
  const floorBefore = state();
  floorBefore.林茜.堕落 = 0;
  const pendingFront = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      behaviors: [{ tier: "front", count: 1 }],
    },
  });
  const beforeSettlement = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: pendingFront,
    priorFacts: [],
    floorBefore,
  });
  assert.equal(beforeSettlement.林茜.堕落, 0);
  const settlementOnly = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      settlementTriggered: true,
    },
  });
  const settled = derive({
    before: beforeSettlement,
    candidate: structuredClone(beforeSettlement),
    facts: settlementOnly,
    priorFacts: [pendingFront],
    floorBefore,
  });
  assert.equal(
    settled.林茜.堕落,
    40,
    "pending behavior is retained until a later source reaches the settlement point",
  );

  for (const [firstTier, secondTier] of [
    ["touch", "front"],
    ["front", "crouching"],
  ]) {
    const first = neutralFacts({
      corruptionSettlement: {
        ...neutralFacts().corruptionSettlement,
        behaviors: [{ tier: firstTier, count: 1 }],
      },
    });
    const second = neutralFacts({
      corruptionSettlement: {
        ...neutralFacts().corruptionSettlement,
        settlementTriggered: true,
        behaviors: [{ tier: secondTier, count: 1 }],
      },
    });
    const result = derive({
      before: floorBefore,
      candidate: structuredClone(floorBefore),
      facts: second,
      priorFacts: [first],
      floorBefore,
    });
    assert.equal(
      result.林茜.堕落,
      40,
      `different base behaviors ${firstTier}/${secondTier} do not share repetition counts`,
    );
  }

  const groupedBehaviors = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      behaviors: [
        { tier: "front", count: 1 },
        { tier: "crouching", count: 1 },
      ],
    },
  });
  const finalFront = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      settlementTriggered: true,
      behaviors: [{ tier: "front", count: 2 }],
    },
  });
  assert(validateFactsSchema(groupedBehaviors));
  const groupedResult = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: finalFront,
    priorFacts: [groupedBehaviors],
    floorBefore,
  });
  assert.equal(
    groupedResult.林茜.堕落,
    50,
    "all behavior kinds in one source retain independent occurrence totals",
  );

  const splitFront = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      behaviors: [{ tier: "front", count: 1 }],
    },
  });
  const splitCrouching = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      behaviors: [{ tier: "crouching", count: 1 }],
    },
  });
  const splitResult = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: finalFront,
    priorFacts: [splitFront, splitCrouching],
    floorBefore,
  });
  assert.equal(
    splitResult.林茜.堕落,
    groupedResult.林茜.堕落,
    "grouped and split source batches produce the same behavior settlement",
  );

  const pendingSpecial = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      specialStimulatorOnly: true,
      behaviors: [{ tier: "stimulator", count: 1 }],
      resultTier: "swallowed",
    },
  });
  const specialResult = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: settlementOnly,
    priorFacts: [pendingSpecial],
    floorBefore,
  });
  assert.equal(
    specialResult.林茜.堕落,
    5,
    "a special-only claim from an earlier batch survives until settlement and suppresses outcome additions",
  );

  const ordinarySettlement = neutralFacts({
    corruptionSettlement: {
      ...neutralFacts().corruptionSettlement,
      settlementTriggered: true,
      behaviors: [{ tier: "front", count: 1 }],
    },
  });
  const cancelledSpecial = derive({
    before: floorBefore,
    candidate: structuredClone(floorBefore),
    facts: ordinarySettlement,
    priorFacts: [pendingSpecial],
    floorBefore,
  });
  assert.equal(
    cancelledSpecial.林茜.堕落,
    50,
    "another base behavior cancels the special-only branch and retains the highest result",
  );
}

{
  const sourceEntries = new Map(
    sourceCard.character_book.entries.map((entry) => [entry.id, entry]),
  );
  const required = new Set([110, 112, 113, 114, 115]);
  const expectedIds = sourceCard.character_book.entries
    .filter(
      (entry) =>
        required.has(entry.id) ||
        entry.id === 111 ||
        /<事件_E\d+|<事件_D00[123]|<终局阶段_Z/.test(entry.content),
    )
    .map((entry) => entry.id);
  assert.deepEqual(
    rules.entries.map((entry) => entry.sourceId),
    expectedIds,
  );
  for (const entry of rules.entries)
    assert.equal(
      entry.originalContent,
      sourceEntries.get(entry.sourceId).content,
      `source ${entry.sourceId} must remain exact`,
    );
  assert.deepEqual(
    new Set(conversion.sourceRuleMappings.map((mapping) => mapping.sourceId)),
    required,
  );
  assert(
    conversion.sourceRuleMappings.every(
      (mapping) => mapping.status && mapping.target.length,
    ),
  );
  assert.equal(conversion.uncovered.length, 0);
  assert.deepEqual(rules.structuredIndex.oneTimeEventOrder, eventOrder);
  assert(
    Object.values(rules.structuredIndex.oneTimeEvents).every(
      (entry) => entry.sourceIds.length,
    ),
  );
  for (const stage of Object.keys(rules.structuredIndex.endingStages)) {
    if (stage === "Z010" || stage === "Z013") continue;
    assert(
      rules.structuredIndex.endingStages[stage].sourceIds.length,
      `${stage} source missing`,
    );
  }
  assert(rules.structuredIndex.sharedEndingStage.Z010_Z013.sourceIds.length);
  assert.deepEqual(
    new Set(
      conversion.associatedRequirementMappings.map(
        (mapping) => mapping.sourceId,
      ),
    ),
    new Set(expectedIds.filter((id) => !required.has(id))),
  );
}

console.log(
  "Linqian state conversion passed: two openings, clock/A1 rollover, coercion/clamp/missing rejection, tuple4, event order, completion, ending locks, multi-agent settlement, and complete source mapping.",
);
