import { derive } from "../variable-tools/derive.js";
import constants from "../../data/state-rules.json" with { type: "json" };

const {
  eventOrder,
  weekdaysByUtcDay,
  routeValues,
  endingStageValues,
  errorMessages,
} = constants;

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function actualDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year < 1 || month < 1 || month > 12) return null;
  const maximumDay = month === 2 && isLeapYear(year) ? 29 : monthLengths[month - 1];
  if (day < 1 || day > maximumDay) return null;
  let days = (year - 1) * 365 + Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400) + day - 1;
  for (let index = 1; index < month; index += 1) days += index === 2 && isLeapYear(year) ? 29 : monthLengths[index - 1];
  return { days: days };
}

function issue(issues, path, code) {
  issues.push({ path: path, code: code, message: errorMessages[code] });
}

export function validate(context) {
  const before = context.before;
  const candidate = context.candidate;
  const facts = context.facts;
  const priorFacts = context.priorFacts;
  const floorBefore = context.floorBefore;
  const issues = [];
  const person = candidate?.林茜;
  const world = candidate?.世界;

  for (const [path, value, min, max, integer] of [
    ["/林茜/感情", person?.感情, 0, 999, false],
    ["/林茜/堕落", person?.堕落, 0, 999, false],
    ["/世界/小时", world?.小时, 0, 23, true],
    ["/世界/分钟", world?.分钟, 0, 59, true],
    ["/世界/状态_A1_计数", world?.状态_A1_计数, 0, 9, true],
  ]) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      issue(issues, path, "NUMBER_INVALID");
    }
  }

  if (
    typeof person?.内心想法 !== "string" ||
    !/^\*\*[\s\S]+\*\*$/.test(person.内心想法)
  ) {
    issue(issues, "/林茜/内心想法", "INNER_THOUGHT_INVALID");
  }

  const options = candidate?.行动选项;
  if (
    !Array.isArray(options) ||
    options.length !== 4 ||
    options.some((value) => typeof value !== "string" || !value.trim())
  ) {
    issue(issues, "/行动选项", "OPTIONS_TUPLE_INVALID");
  } else {
    if (new Set(options.map((value) => value.trim())).size !== 4)
      issue(issues, "/行动选项", "OPTIONS_DUPLICATED");
    for (const index of [0, 3])
      if (!options[index].trim().startsWith("元指令:"))
        issue(issues, `/行动选项/${index}`, "OPTION_PREFIX_INVALID");
  }

  const date = actualDate(world?.日期);
  const a1Date = actualDate(world?.状态_A1_日期);
  const d001Date = actualDate(world?.事件_D001记录日期);
  if (!date) issue(issues, "/世界/日期", "DATE_INVALID");
  if (!a1Date) issue(issues, "/世界/状态_A1_日期", "DATE_INVALID");
  if (!d001Date) issue(issues, "/世界/事件_D001记录日期", "DATE_INVALID");
  if (date && world.星期 !== weekdaysByUtcDay[(date.days + 1) % 7])
    issue(issues, "/世界/星期", "WEEKDAY_MISMATCH");
  if (typeof world?.地点 !== "string" || !world.地点.trim())
    issue(issues, "/世界/地点", "LOCATION_MISSING");

  let foundGap = false;
  for (const event of eventOrder) {
    const value = world?.已触发事件?.[event];
    if (value !== true && value !== false)
      issue(issues, `/世界/已触发事件/${event}`, "EVENT_FLAG_INVALID");
    if (value === false) foundGap = true;
    else if (value === true && foundGap)
      issue(issues, `/世界/已触发事件/${event}`, "EVENT_ORDER_INVALID");
  }

  if (before?.世界?.已离婚 === true && world?.已离婚 !== true)
    issue(issues, "/世界/已离婚", "DIVORCE_REVERTED");
  if (
    before?.世界?.终局阶段 !== endingStageValues[0] &&
    world?.终局阶段 === endingStageValues[0]
  )
    issue(issues, "/世界/终局阶段", "ENDING_STAGE_REVERTED");
  if (
    before?.世界?.终局路线 !== routeValues.unassigned &&
    world?.终局路线 !== before.世界.终局路线 &&
    facts?.ending?.explicitReselection !== true
  ) {
    issue(issues, "/世界/终局路线", "ENDING_ROUTE_LOCKED");
  }

  const expected = derive({
    before: before,
    candidate: candidate,
    facts: facts,
    priorFacts: priorFacts,
    floorBefore: floorBefore,
  });
  for (const [path, actual, wanted] of [
    ["/林茜/感情", candidate?.林茜?.感情, expected?.林茜?.感情],
    ["/林茜/堕落", candidate?.林茜?.堕落, expected?.林茜?.堕落],
    ["/世界/日期", world?.日期, expected?.世界?.日期],
    ["/世界/时间", world?.时间, expected?.世界?.时间],
    ["/世界/已触发事件", world?.已触发事件, expected?.世界?.已触发事件],
    ["/世界/终局路线", world?.终局路线, expected?.世界?.终局路线],
    ["/世界/终局阶段", world?.终局阶段, expected?.世界?.终局阶段],
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      issue(issues, path, "DERIVED_VALUE_MISMATCH");
  }
  return { issues: issues };
}
