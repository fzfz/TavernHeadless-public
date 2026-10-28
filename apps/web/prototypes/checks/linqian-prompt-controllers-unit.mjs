import assert from "node:assert/strict";
import fs from "node:fs";
import { renderController } from "../characters/linqian/prompt-controllers.js";

const characterDirectory = new URL("../characters/linqian/", import.meta.url);
const readJson = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, characterDirectory), "utf8"));
const snapshot = readJson("snapshot.json");
const openings = readJson("opening-states.json");
const configuration = readJson("prompt-controllers.json");
const characterBook = snapshot.characterBook;
const entriesById = new Map(
  characterBook.entries.map((entry) => [entry.id, entry]),
);

function expectedText(entryIds) {
  return entryIds.map((entryId) => entriesById.get(entryId).content).join("");
}

async function assertReferences(entryId, variables, expectedEntryIds) {
  const result = await renderController({ entryId, variables, characterBook });
  assert.deepEqual(result.referencedEntryIds, expectedEntryIds);
  assert.equal(result.text, expectedText(expectedEntryIds));
}

function baseVariables() {
  const variables = structuredClone(openings.first);
  variables.林茜.感情 = undefined;
  variables.林茜.堕落 = undefined;
  variables.世界.日期 = "2025-03-10";
  variables.世界.事件_D001记录日期 = "2025-03-10";
  variables.世界.状态_A1_日期 = "2025-03-10";
  variables.世界.状态_A1_计数 = 9;
  variables.世界.终局路线 = "未定";
  variables.世界.终局阶段 = "Z000";
  for (const eventName of Object.keys(variables.世界.已触发事件))
    variables.世界.已触发事件[eventName] = false;
  return variables;
}

assert.deepEqual(configuration, {
  version: 1,
  controllers: [
    {
      entryId: 109,
      sourceEntryId: 109,
      sourceComment: "林茜_身体边界控制器",
    },
    {
      entryId: 111,
      sourceEntryId: 111,
      sourceComment: "关键事件控制器",
    },
    {
      entryId: 127,
      sourceEntryId: 127,
      sourceComment: "开局前提控制器",
    },
  ],
});
for (const controller of configuration.controllers) {
  assert.equal(
    entriesById.get(controller.sourceEntryId)?.comment,
    controller.sourceComment,
  );
}

await assert.rejects(
  renderController({ entryId: 999, variables: openings.first, characterBook }),
  /Unknown controller entryId: 999/,
);
await assert.rejects(
  renderController({
    entryId: 127,
    variables: openings.first,
    characterBook: {},
  }),
  /characterBook must contain a non-empty name and an entries array/,
);
{
  const missingReferenceBook = {
    ...characterBook,
    entries: characterBook.entries.filter((entry) => entry.id !== 117),
  };
  await assert.rejects(
    renderController({
      entryId: 127,
      variables: openings.first,
      characterBook: missingReferenceBook,
    }),
    /missing entry comment: 开局前提_原始首次撞见/,
  );
}

await assertReferences(127, openings.first, [117]);
await assertReferences(109, openings.first, [89, 92, 93, 94, 98]);
await assertReferences(111, openings.first, []);
await assertReferences(127, openings["alternate-1"], [136]);
await assertReferences(109, openings["alternate-1"], [89, 92, 93, 96, 101]);
await assertReferences(111, openings["alternate-1"], [10, 46]);

const premiseCases = [
  ["默认拆迁旧楼", 116],
  ["旧楼电话纠缠", 123],
  ["原始首次撞见", 117],
  ["远程监控", 118],
  ["画室监控", 119],
  ["302监控", 120],
  ["王授军私宅3P", 121],
  ["黑哥逃脱", 122],
  ["跪倒屈服", 124],
  ["繁衍", 125],
  ["画室赴约", 136],
];
for (const [openingMode, expectedEntryId] of premiseCases) {
  const variables = baseVariables();
  variables.世界.开局模式 = ` ${openingMode} `;
  await assertReferences(127, variables, [expectedEntryId]);
}
for (const openingMode of ["不存在的开局", "", null, 3]) {
  const variables = baseVariables();
  variables.世界.开局模式 = openingMode;
  await assertReferences(127, variables, []);
}

const feelingCases = [
  [0, [89, 90]],
  [299, [89, 90]],
  [300, [89, 91]],
  [449, [89, 91]],
  [450, [89, 92]],
  [999, [89, 92]],
  [-1, []],
  [1000, []],
  [Number.NaN, []],
];
for (const [feeling, expectedEntryIds] of feelingCases) {
  const variables = baseVariables();
  variables.林茜.感情 = feeling;
  await assertReferences(109, variables, expectedEntryIds);
}

const corruptionCases = [
  [0, [93, 94, 98]],
  [80, [93, 94, 98]],
  [81, [93, 94, 99]],
  [199, [93, 94, 99]],
  [200, [93, 95, 99]],
  [219, [93, 95, 99]],
  [220, [93, 95, 100]],
  [379, [93, 95, 100]],
  [380, [93, 96, 101]],
  [619, [93, 96, 101]],
  [620, [93, 97, 102]],
  [999, [93, 97, 102]],
  [-1, []],
  [1000, []],
  [Number.POSITIVE_INFINITY, []],
];
for (const [corruption, expectedEntryIds] of corruptionCases) {
  const variables = baseVariables();
  variables.林茜.堕落 = corruption;
  await assertReferences(109, variables, expectedEntryIds);
}

const wangEventCases = [
  [{ 事件_E012: true }, [103, 104]],
  [{ 事件_E012: true, 事件_E020: true }, [103, 105]],
  [{ 事件_E012: true, 事件_E020: true, 事件_E023: true }, [103, 106]],
  [
    {
      事件_E012: true,
      事件_E020: true,
      事件_E023: true,
      事件_E030: true,
    },
    [103, 107],
  ],
  [
    {
      事件_E012: true,
      事件_E020: true,
      事件_E023: true,
      事件_E030: true,
      事件_E032: true,
    },
    [103, 108],
  ],
  [
    {
      事件_E012: true,
      事件_E020: true,
      事件_E023: true,
      事件_E030: true,
      事件_E032: true,
      事件_E035: true,
    },
    [],
  ],
  [{ 事件_E020: true }, []],
];
for (const [eventOverrides, expectedEntryIds] of wangEventCases) {
  const variables = baseVariables();
  Object.assign(variables.世界.已触发事件, eventOverrides);
  await assertReferences(109, variables, expectedEntryIds);
}

const eventCases = [
  ["事件_E001", 87, 38],
  ["事件_E002", 140, 39],
  ["事件_E003", 140, 40],
  ["事件_E004", 180, 63],
  ["事件_E005", 220, 41],
  ["事件_E006", 260, 64],
  ["事件_E008", 292.5, 42],
  ["事件_E009", 387.5, 43],
  ["事件_E010", 387.5, 44],
  ["事件_E011", null, 45],
  ["事件_E012", 477.5, 46],
  ["事件_E013", 500, 50],
  ["事件_E014", 520, 51],
  ["事件_E015", 520, 52],
  ["事件_E016", 567.5, 53],
  ["事件_E017", 567.5, 54],
  ["事件_E018", 567.5, 48],
  ["事件_E019", 567.5, 47],
  ["事件_E020", 567.5, 55],
  ["事件_E021", 620, 56],
  ["事件_E022", 720, 49],
  ["事件_E023", 760, 57],
  ["事件_E024", 820, 58],
  ["事件_E025", 880, 59],
  ["事件_E026", 900, 60],
  ["事件_E027", 927.5, 135],
  ["事件_E028", 927.5, 61],
  ["事件_E029", 927.5, 62],
  ["事件_E030", 927.5, 67],
  ["事件_E031", null, 69],
  ["事件_E032", 940, 68],
  ["事件_E033", null, 70],
  ["事件_E034", 950, 71],
  ["事件_E035", 950, 72],
];
const eventOrder = [
  ...eventCases.map(([eventName]) => eventName),
  "事件_E048",
  "事件_E049",
];

function variablesForEvent(targetEvent, corruption) {
  const variables = baseVariables();
  variables.林茜.感情 = 999;
  variables.林茜.堕落 = corruption;
  for (const eventName of eventOrder) {
    variables.世界.已触发事件[eventName] = eventName !== targetEvent;
    if (eventName === targetEvent) break;
  }
  return variables;
}

function fixedReferenceIds(events) {
  const entryIds = [];
  if (events.事件_E003 === true) entryIds.push(10);
  if (events.事件_E013 === true && events.事件_E029 === false)
    entryIds.push(11);
  if (events.事件_E029 === true) entryIds.push(12);
  if (events.事件_E013 === true) entryIds.push(13);
  if (events.事件_E020 === true) entryIds.push(137);
  if (events.事件_E032 === true) entryIds.push(110);
  return entryIds;
}

for (const [eventName, threshold, expectedEventEntryId] of eventCases) {
  const variables = variablesForEvent(eventName, threshold ?? 0);
  const fixed = fixedReferenceIds(variables.世界.已触发事件);
  await assertReferences(111, variables, [...fixed, expectedEventEntryId]);
  if (threshold !== null) {
    variables.林茜.堕落 = threshold - 0.001;
    await assertReferences(111, variables, fixed);
  }
}

function completedEventsVariables() {
  const variables = baseVariables();
  variables.林茜.感情 = 999;
  variables.林茜.堕落 = 999;
  for (const eventName of eventOrder)
    variables.世界.已触发事件[eventName] =
      eventName !== "事件_E048" && eventName !== "事件_E049";
  return variables;
}

const fixedCompletedReferences = [10, 12, 13, 137, 110];
const terminalRouteCases = [
  ["结局三_隔离守婚", "Z004"],
  ["结局二_三人共处", "Z007"],
  ["结局一_离婚", "Z012"],
  ["双向出轨", "Z013"],
];
for (const [route, stage] of terminalRouteCases) {
  const variables = completedEventsVariables();
  variables.世界.终局路线 = route;
  variables.世界.终局阶段 = stage;
  await assertReferences(111, variables, [...fixedCompletedReferences, 65]);
}

{
  const variables = completedEventsVariables();
  variables.世界.已触发事件.事件_E048 = true;
  await assertReferences(111, variables, [...fixedCompletedReferences, 66]);
}

const endingStageCases = [
  ["结局三_隔离守婚", "Z001", 999, 999, 83],
  ["结局三_隔离守婚", "Z003", 999, 999, 84],
  ["结局三_隔离守婚", "Z000", 999, 999, 82],
  ["结局二_三人共处", "Z000", 999, 950, 73],
  ["结局二_三人共处", "Z002", 999, 950, 74],
  ["结局二_三人共处", "Z006", 999, 0, 81],
  ["结局二_三人共处", "Z005", 999, 0, 80],
  ["结局一_离婚", "Z000", 999, 950, 73],
  ["结局一_离婚", "Z002", 999, 950, 74],
  ["结局一_离婚", "Z008", 999, 0, 77],
  ["结局一_离婚", "Z010", 999, 0, 79],
  ["结局一_离婚", "Z011", 999, 0, 78],
  ["结局一_离婚", "Z005", 999, 950, 75],
  ["双向出轨", "Z000", 999, 950, 73],
  ["双向出轨", "Z002", 999, 950, 74],
  ["双向出轨", "Z009", 999, 0, 77],
  ["双向出轨", "Z005", 999, 0, 76],
  ["未定", "Z000", 999, 950, 73],
  ["未定", "Z002", 999, 950, 74],
  ["未定", "Z005", 820, 950, 75],
];
for (const [
  route,
  stage,
  feeling,
  corruption,
  expectedEntryId,
] of endingStageCases) {
  const variables = completedEventsVariables();
  variables.世界.终局路线 = route;
  variables.世界.终局阶段 = stage;
  variables.林茜.感情 = feeling;
  variables.林茜.堕落 = corruption;
  await assertReferences(111, variables, [
    ...fixedCompletedReferences,
    expectedEntryId,
  ]);
}
for (const [route, stage, feeling, corruption] of [
  ["结局二_三人共处", "Z000", 999, 949.999],
  ["结局一_离婚", "Z005", 999, 949.999],
  ["未定", "Z005", 819.999, 950],
]) {
  const variables = completedEventsVariables();
  variables.世界.终局路线 = route;
  variables.世界.终局阶段 = stage;
  variables.林茜.感情 = feeling;
  variables.林茜.堕落 = corruption;
  await assertReferences(111, variables, fixedCompletedReferences);
}

{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.世界.日期 = "2025-03-11";
  variables.世界.事件_D001记录日期 = "2025-03-10";
  await assertReferences(111, variables, [126]);
}
{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.林茜.堕落 = 60;
  variables.世界.状态_A1_计数 = 0;
  await assertReferences(111, variables, [86]);
}
{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.世界.已触发事件.事件_E018 = true;
  variables.林茜.堕落 = 350;
  variables.世界.状态_A1_计数 = 0;
  await assertReferences(111, variables, [86, 85]);
}
{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.世界.已触发事件.事件_E018 = true;
  variables.林茜.堕落 = 600;
  variables.世界.状态_A1_计数 = 2;
  await assertReferences(111, variables, [86]);
  variables.世界.状态_A1_日期 = "2025-03-09";
  await assertReferences(111, variables, [86, 85]);
}
{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.世界.已触发事件.事件_E018 = true;
  variables.林茜.堕落 = 600;
  variables.世界.状态_A1_计数 = 0;
  variables.世界.终局阶段 = "Z005";
  await assertReferences(111, variables, [85]);
}
{
  const variables = baseVariables();
  variables.世界.已触发事件.事件_E001 = null;
  variables.林茜.堕落 = 600;
  variables.世界.日期 = "2025-02-30";
  variables.世界.事件_D001记录日期 = "2025-03-09";
  variables.世界.状态_A1_日期 = "2025-03-09";
  variables.世界.状态_A1_计数 = 0;
  await assertReferences(111, variables, []);
}

const controllerSource = fs.readFileSync(
  new URL("../characters/linqian/prompt-controllers.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(controllerSource, /\beval\s*\(/);
assert.doesNotMatch(controllerSource, /\bnew\s+Function\b/);

console.log("linqian prompt controller unit checks passed");
