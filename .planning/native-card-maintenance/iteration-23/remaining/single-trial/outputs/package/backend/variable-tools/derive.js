import constants from "../../data/state-rules.json" with { type: "json" };

const {
  eventOrder,
  weekdaysByUtcDay,
  periodByHour,
  routeValues,
  relationship,
  corruption,
} = constants;

function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value)) result[key] = clone(value[key]);
    return result;
  }
  return value;
}

function hasOwn(object, key) {
  return (
    object !== null && typeof object === "object" && Object.hasOwn(object, key)
  );
}

function coerceFinite(object, key, minimum, maximum, integer = false) {
  if (!hasOwn(object, key)) return;
  const value = Number(object[key]);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) return;
  object[key] = Math.min(maximum, Math.max(minimum, value));
}

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysBeforeYear(year) {
  const previous = year - 1;
  return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : monthLengths[month - 1];
}

function parseDate(date, hour, minute) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const parts = String(date).split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  let days = daysBeforeYear(year) + day - 1;
  for (let index = 1; index < month; index += 1) days += daysInMonth(year, index);
  return { year: year, month: month, day: day, hour: hour, minute: minute, days: days };
}

function dateFromDayIndex(days) {
  if (!Number.isInteger(days) || days < 0 || days >= daysBeforeYear(10000)) return null;
  let low = 1;
  let high = 10000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(middle) <= days) low = middle;
    else high = middle;
  }
  let remaining = days - daysBeforeYear(low);
  let month = 1;
  while (remaining >= daysInMonth(low, month)) {
    remaining -= daysInMonth(low, month);
    month += 1;
  }
  const date = String(low).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(remaining + 1).padStart(2, "0");
  return { date: date, year: low, month: month, day: remaining + 1 };
}

function periodFor(hour) {
  return periodByHour[hour];
}

function deriveClock(before, result, facts) {
  const world = before?.世界;
  const candidateWorld = result?.世界;
  if (!world || !candidateWorld) return;
  const start = parseDate(world.日期, world.小时, world.分钟);
  const elapsed = facts?.elapsedMinutes;
  if (!start || !Number.isInteger(elapsed) || elapsed < 0) return;
  const endMinutes = start.days * 1440 + start.hour * 60 + start.minute + elapsed;
  const endDays = Math.floor(endMinutes / 1440);
  const end = dateFromDayIndex(endDays);
  if (!end) return;
  const minuteOfDay = endMinutes - endDays * 1440;
  candidateWorld.日期 = end.date;
  candidateWorld.星期 = weekdaysByUtcDay[(endDays + 1) % 7];
  candidateWorld.小时 = Math.floor(minuteOfDay / 60);
  candidateWorld.分钟 = minuteOfDay % 60;
  candidateWorld.时间 = periodFor(candidateWorld.小时);
}

function deriveA1(before, result, facts) {
  const previous = before?.世界;
  const world = result?.世界;
  if (!previous || !world) return;
  const priorDateValid = parseDate(previous.状态_A1_日期, 0, 0);
  const endDateValid = parseDate(world.日期, 0, 0);
  const priorCountValid =
    Number.isInteger(previous.状态_A1_计数) &&
    previous.状态_A1_计数 >= 0 &&
    previous.状态_A1_计数 <= 9;
  if (!priorDateValid || !endDateValid || !priorCountValid) return;
  const crossedDate = previous.状态_A1_日期 !== world.日期;
  const completions = Array.isArray(facts?.completedA1Events)
    ? facts.completedA1Events.filter(
        (event) =>
          (event?.kind === "D002" || event?.kind === "D003") &&
          event.completedDate === world.日期,
      ).length
    : 0;
  world.状态_A1_日期 = crossedDate ? world.日期 : previous.状态_A1_日期;
  world.状态_A1_计数 = Math.min(
    9,
    (crossedDate ? 0 : previous.状态_A1_计数) + completions,
  );
}

function deriveEvents(before, result, facts) {
  if (!before?.世界?.已触发事件 || !result?.世界) return;
  const events = clone(before.世界.已触发事件);
  const completed = new Set(
    Array.isArray(facts?.completedOneTimeEvents)
      ? facts.completedOneTimeEvents
      : [],
  );
  let blocked = false;
  for (const event of eventOrder) {
    if (events[event] === true) continue;
    if (!blocked && completed.has(event)) events[event] = true;
    else blocked = true;
  }
  result.世界.已触发事件 = events;
}

function relationshipTotals(factsList) {
  let positive = 0;
  let negative = false;
  let intimacy = 0;
  for (const facts of factsList) {
    const positiveDelta = facts?.relationship?.positiveDelta;
    const negativeDelta = facts?.relationship?.negativeDelta;
    if (Number.isInteger(positiveDelta) && positiveDelta > 0)
      positive += positiveDelta;
    if (negativeDelta === relationship.dailyMinimum) negative = true;
    intimacy = Math.max(
      intimacy,
      relationship.intimacyTiers[facts?.relationship?.intimacyTier] ?? 0,
    );
  }
  return {
    daily:
      Math.min(relationship.dailyPositiveMaximum, positive) -
      (negative ? Math.abs(relationship.dailyMinimum) : 0),
    intimacy: intimacy,
  };
}

function corruptionTotal(factsList) {
  const records = factsList.map((facts) => facts?.corruptionSettlement);
  let settlementIndex = -1;
  for (let index = 0; index < records.length; index += 1)
    if (records[index]?.settlementTriggered === true) settlementIndex = index;
  if (settlementIndex < 0) return 0;

  const settledRecords = records.slice(0, settlementIndex + 1).filter(Boolean);
  const occurrenceByTier = new Map();
  let outcome = 0;
  let anomaly = false;
  let specialClaimed = false;
  for (const value of settledRecords) {
    for (const behavior of value.behaviors ?? []) {
      if (
        behavior.tier in corruption.baseValues &&
        behavior.tier !== "none" &&
        Number.isInteger(behavior.count)
      ) {
        occurrenceByTier.set(
          behavior.tier,
          Math.min(
            3,
            (occurrenceByTier.get(behavior.tier) ?? 0) + behavior.count,
          ),
        );
      }
    }
    outcome = Math.max(outcome, corruption.resultValues[value.resultTier] ?? 0);
    anomaly ||= value.materialAnomaly === true;
    specialClaimed ||= value.specialStimulatorOnly === true;
  }

  const onlyStimulator = [...occurrenceByTier.keys()].every(
    (tier) => tier === "stimulator",
  );
  if (specialClaimed && occurrenceByTier.size > 0 && onlyStimulator) return 5;

  let highestBehavior = 0;
  for (const [tier, occurrences] of occurrenceByTier) {
    const base = corruption.baseValues[tier];
    const repetition = occurrences >= 3 ? 10 : occurrences === 2 ? 5 : 0;
    highestBehavior = Math.max(highestBehavior, base + repetition);
  }
  return Math.min(
    corruption.maximumDelta,
    highestBehavior + outcome + (anomaly ? 5 : 0),
  );
}

function deriveNumbers(before, result, facts, priorFacts, floorBefore) {
  if (!before?.林茜 || !result?.林茜) return;
  const floorAffection = Number(floorBefore?.林茜?.感情 ?? before.林茜.感情);
  const floorCorruption = Number(floorBefore?.林茜?.堕落 ?? before.林茜.堕落);
  const previousFacts = Array.isArray(priorFacts) ? priorFacts : [];
  if (Number.isFinite(floorAffection)) {
    const current = relationshipTotals([...previousFacts, facts]);
    result.林茜.感情 = Math.min(
      999,
      Math.max(0, floorAffection + current.daily + current.intimacy),
    );
  }
  if (!Number.isFinite(floorCorruption)) return;
  result.林茜.堕落 = Math.min(
    999,
    Math.max(0, floorCorruption + corruptionTotal([...previousFacts, facts])),
  );
}

function deriveEnding(before, result, facts) {
  if (!before?.世界 || !result?.世界) return;
  const world = result.世界;
  const prior = before.世界;
  world.终局路线 = prior.终局路线;
  world.终局阶段 = prior.终局阶段;
  world.已离婚 = prior.已离婚;
  world.开局模式 = prior.开局模式;

  const ending = facts?.ending;
  if (ending?.routeRulesLoaded === true && ending.formedRoute) {
    if (
      prior.终局路线 === routeValues.unassigned ||
      ending.explicitReselection === true
    )
      world.终局路线 = ending.formedRoute;
  }
  if (ending?.routeRulesLoaded === true && ending.divorceFormed === true)
    world.已离婚 = true;

  const completed = ending?.completedStage;
  if (completed === constants.sharedEndingStage) {
    if (prior.终局路线 === routeValues.divorce) world.终局阶段 = "Z010";
    if (prior.终局路线 === routeValues.mutualInfidelity)
      world.终局阶段 = "Z013";
  } else if (
    typeof completed === "string" &&
    /^Z00[1-9]$|^Z01[0-3]$/.test(completed)
  ) {
    world.终局阶段 = completed;
  }
}

export function derive({ before, candidate, facts, priorFacts, floorBefore }) {
  const result = clone(candidate);
  if (result?.林茜) {
    coerceFinite(result.林茜, "感情", 0, 999);
    coerceFinite(result.林茜, "堕落", 0, 999);
  }
  if (result?.世界) {
    coerceFinite(result.世界, "小时", 0, 23, true);
    coerceFinite(result.世界, "分钟", 0, 59, true);
    coerceFinite(result.世界, "状态_A1_计数", 0, 9);
  }
  deriveClock(before, result, facts);
  if (
    result?.世界 &&
    typeof facts?.finalLocation === "string" &&
    facts.finalLocation.trim()
  ) {
    result.世界.地点 = facts.finalLocation.trim();
  }
  deriveA1(before, result, facts);
  if (facts?.d001Completed === true && result?.世界)
    result.世界.事件_D001记录日期 = result.世界.日期;
  deriveEvents(before, result, facts);
  deriveNumbers(before, result, facts, priorFacts, floorBefore);
  deriveEnding(before, result, facts);
  return result;
}

