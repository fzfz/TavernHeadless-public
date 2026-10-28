function getVariable(variables, path) {
  if (typeof path !== "string") return undefined;
  const parts = path.split(".");
  if (parts.shift() !== "stat_data") return undefined;
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part)))
    return undefined;
  let value = variables;
  for (const part of parts) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = value[part];
  }
  return value;
}

function createRuntime(variables, characterBook) {
  if (
    characterBook === null ||
    typeof characterBook !== "object" ||
    typeof characterBook.name !== "string" ||
    !characterBook.name ||
    !Array.isArray(characterBook.entries)
  ) {
    throw new TypeError(
      "characterBook must contain a non-empty name and an entries array",
    );
  }

  const printed = [];
  const referencedEntryIds = [];
  return {
    charLoreBook: characterBook.name,
    getvar(path) {
      return getVariable(variables, path);
    },
    async getwi(worldbookName, comment) {
      if (worldbookName !== characterBook.name) {
        throw new Error(`Unknown character book: ${worldbookName}`);
      }
      const entry = characterBook.entries.find(
        (candidate) => candidate?.comment === comment,
      );
      if (!entry) {
        throw new Error(
          `Character book ${characterBook.name} is missing entry comment: ${comment}`,
        );
      }
      if (typeof entry.content !== "string") {
        throw new TypeError(
          `Character book entry ${String(entry.id)} must contain string content`,
        );
      }
      referencedEntryIds.push(entry.id);
      return entry.content;
    },
    print(value) {
      printed.push(String(value));
    },
    result() {
      return { text: printed.join(""), referencedEntryIds: referencedEntryIds };
    },
  };
}

async function render104(runtime) {
  const { charLoreBook, getvar, getwi, print } = runtime;
  const controllerWorldbook = charLoreBook || "林茜_世界书_v1.3.32";
  const bodyFeeling = getvar("stat_data.林茜.感情");
  const bodyFall = getvar("stat_data.林茜.堕落");
  const validScore = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 999;

  if (!validScore(bodyFeeling) || !validScore(bodyFall)) return;

  print(await getwi(controllerWorldbook, "林茜_身体边界_用户共同"));
  if (bodyFeeling >= 450) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_用户_450以上"));
  } else if (bodyFeeling >= 300) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_用户_300_449"));
  } else {
    print(await getwi(controllerWorldbook, "林茜_身体边界_用户_299以下"));
  }

  print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子共同"));
  if (bodyFall >= 620) {
    print(await getwi(controllerWorldbook, "杨桃子_称呼阶段_620以上"));
  } else if (bodyFall >= 380) {
    print(await getwi(controllerWorldbook, "杨桃子_称呼阶段_380_619"));
  } else if (bodyFall >= 200) {
    print(await getwi(controllerWorldbook, "杨桃子_称呼阶段_200_379"));
  } else {
    print(await getwi(controllerWorldbook, "杨桃子_称呼阶段_0_199"));
  }

  if (bodyFall >= 620) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子_620以上"));
  } else if (bodyFall >= 380) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子_380_619"));
  } else if (bodyFall >= 220) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子_220_379"));
  } else if (bodyFall >= 81) {
    print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子_81_219"));
  } else {
    print(await getwi(controllerWorldbook, "林茜_身体边界_杨桃子_0_80"));
  }

  const eventConsent = getvar("stat_data.世界.已触发事件.事件_E012") === true;
  const eventDeath = getvar("stat_data.世界.已触发事件.事件_E035") === true;
  if (eventConsent && !eventDeath)
    print(await getwi(controllerWorldbook, "林茜_身体边界_王授军"));
}

async function render107(runtime) {
  const { charLoreBook, getvar, getwi, print } = runtime;
  const controllerWorldbook = charLoreBook || "林茜_世界书_v1.3.32";
  const source = await getwi(controllerWorldbook, "变量列表");
  const formatted = source.replace(/{{format_message_variable::([^{}]+)}}/g, (_match, path) => {
    const value = getvar(path.trim());
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
  print(formatted);
}

async function render106(runtime) {
  const { charLoreBook, getvar, getwi, print } = runtime;
  var controllerWorldbook = charLoreBook || "林茜_世界书_v1.3.32";
  var eventGwRaw = getvar("stat_data.林茜.感情");
  var eventDlRaw = getvar("stat_data.林茜.堕落");
  var eventDateRaw = getvar("stat_data.世界.日期");
  var endingRouteRaw = getvar("stat_data.世界.终局路线");
  var endingStageRaw = getvar("stat_data.世界.终局阶段");
  var eventD001RecordDateRaw = getvar("stat_data.世界.事件_D001记录日期");
  var eventStateA1DateRaw = getvar("stat_data.世界.状态_A1_日期");
  var eventStateA1CountRaw = getvar("stat_data.世界.状态_A1_计数");
  var eventE003Raw = getvar("stat_data.世界.已触发事件.事件_E003");
  var eventE013Raw = getvar("stat_data.世界.已触发事件.事件_E013");
  var eventE018Raw = getvar("stat_data.世界.已触发事件.事件_E018");
  var eventE029Raw = getvar("stat_data.世界.已触发事件.事件_E029");
  var eventE032Raw = getvar("stat_data.世界.已触发事件.事件_E032");
  var eventE034Raw = getvar("stat_data.世界.已触发事件.事件_E034");
  var eventE035Raw = getvar("stat_data.世界.已触发事件.事件_E035");
  var eventE048Raw = getvar("stat_data.世界.已触发事件.事件_E048");
  var eventE020Raw = getvar("stat_data.世界.已触发事件.事件_E020");
  var eventKey = "";
  var endingStageKey = "";

  function eventDone(name) {
    var value = getvar("stat_data.世界.已触发事件." + name);
    return typeof value === "boolean" ? value : null;
  }

  function scoreAtLeast(value, threshold) {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 999 &&
      value >= threshold
    );
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    var parts = value.split("-").map(Number);
    var year = parts[0];
    var month = parts[1];
    var day = parts[2];
    if (year < 1 || month < 1 || month > 12) return false;
    var lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var maximumDay = month === 2 && leap ? 29 : lengths[month - 1];
    return day >= 1 && day <= maximumDay;
  }

  function validEndingRoute(value) {
    return [
      "未定",
      "结局一_离婚",
      "结局二_三人共处",
      "结局三_隔离守婚",
      "双向出轨",
    ].includes(value);
  }

  function validEndingStage(value) {
    return [
      "Z000",
      "Z001",
      "Z002",
      "Z003",
      "Z004",
      "Z005",
      "Z006",
      "Z007",
      "Z008",
      "Z009",
      "Z010",
      "Z011",
      "Z012",
      "Z013",
    ].includes(value);
  }

  function stateA1Limit(value) {
    if (!scoreAtLeast(value, 0)) return null;
    return value >= 600 ? 3 : value >= 350 ? 2 : 1;
  }

  var endingRouteTerminal =
    validEndingRoute(endingRouteRaw) &&
    validEndingStage(endingStageRaw) &&
    ((endingRouteRaw === "结局三_隔离守婚" && endingStageRaw === "Z004") ||
      (endingRouteRaw === "结局二_三人共处" && endingStageRaw === "Z007") ||
      (endingRouteRaw === "结局一_离婚" && endingStageRaw === "Z012") ||
      (endingRouteRaw === "双向出轨" && endingStageRaw === "Z013"));

  var nonIsolationCommonComplete = validEndingStage(endingStageRaw)
    ? [
        "Z005",
        "Z006",
        "Z007",
        "Z008",
        "Z009",
        "Z010",
        "Z011",
        "Z012",
        "Z013",
      ].includes(endingStageRaw)
    : null;

  if (eventDone("事件_E001") === false && scoreAtLeast(eventDlRaw, 87)) {
    eventKey = "事件_1_YJ_旧楼首次性交";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === false &&
    scoreAtLeast(eventDlRaw, 140)
  ) {
    eventKey = "事件_2_YJ_旧楼站立后入";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === false &&
    scoreAtLeast(eventDlRaw, 140)
  ) {
    eventKey = "事件_3_家中监控安装";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === false &&
    scoreAtLeast(eventDlRaw, 180)
  ) {
    eventKey = "事件_4_AM_业务接触";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === false &&
    scoreAtLeast(eventDlRaw, 220)
  ) {
    eventKey = "事件_5_YJ_马镫事件";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === false &&
    scoreAtLeast(eventDlRaw, 260)
  ) {
    eventKey = "事件_6_AM_圆场掩护";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === false &&
    scoreAtLeast(eventDlRaw, 292.5)
  ) {
    eventKey = "事件_8_YJ_跪倒屈服";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === false &&
    scoreAtLeast(eventDlRaw, 387.5)
  ) {
    eventKey = "事件_9_YJ_驱离";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === false &&
    scoreAtLeast(eventDlRaw, 387.5)
  ) {
    eventKey = "事件_10_YJ_旧楼电话纠缠";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === false
  ) {
    eventKey = "事件_11_雨夜小学重逢";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === false &&
    scoreAtLeast(eventDlRaw, 477.5)
  ) {
    eventKey = "事件_12_同意去画室";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === false &&
    scoreAtLeast(eventDlRaw, 500)
  ) {
    eventKey = "事件_13_公开画作威胁";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === false &&
    scoreAtLeast(eventDlRaw, 520)
  ) {
    eventKey = "事件_14_黑哥直播";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === false &&
    scoreAtLeast(eventDlRaw, 520)
  ) {
    eventKey = "事件_15_黑哥直播后续";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === false &&
    scoreAtLeast(eventDlRaw, 567.5)
  ) {
    eventKey = "事件_16_繁衍身体反应";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === false &&
    scoreAtLeast(eventDlRaw, 567.5)
  ) {
    eventKey = "事件_17_繁衍图像识别";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === false &&
    scoreAtLeast(eventDlRaw, 567.5)
  ) {
    eventKey = "事件_18_王授军私下联系";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === false &&
    scoreAtLeast(eventDlRaw, 567.5)
  ) {
    eventKey = "事件_19_取走硬盘";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === false &&
    scoreAtLeast(eventDlRaw, 567.5)
  ) {
    eventKey = "事件_20_401画室录像";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === false &&
    scoreAtLeast(eventDlRaw, 620)
  ) {
    eventKey = "事件_21_王授军住处取证";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === false &&
    scoreAtLeast(eventDlRaw, 720)
  ) {
    eventKey = "事件_22_云盘备份";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === false &&
    scoreAtLeast(eventDlRaw, 760)
  ) {
    eventKey = "事件_23_面壁者原场景";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === false &&
    scoreAtLeast(eventDlRaw, 820)
  ) {
    eventKey = "事件_24_PE资料与生插视频";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === false &&
    scoreAtLeast(eventDlRaw, 880)
  ) {
    eventKey = "事件_25_嗜血之花月经前提";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === false &&
    scoreAtLeast(eventDlRaw, 900)
  ) {
    eventKey = "事件_26_嗜血之花公开";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === false &&
    scoreAtLeast(eventDlRaw, 927.5)
  ) {
    eventKey = "事件_27_嗜血之花原场景";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === false &&
    scoreAtLeast(eventDlRaw, 927.5)
  ) {
    eventKey = "事件_28_曝光开始";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === false &&
    scoreAtLeast(eventDlRaw, 927.5)
  ) {
    eventKey = "事件_29_曝光发酵";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === false &&
    scoreAtLeast(eventDlRaw, 927.5)
  ) {
    eventKey = "事件_30_SP_首次3P";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === false
  ) {
    eventKey = "事件_31_万家宾馆后果";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === false &&
    scoreAtLeast(eventDlRaw, 940)
  ) {
    eventKey = "事件_32_SP_王授军私宅3P录像";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === true &&
    eventDone("事件_E033") === false
  ) {
    eventKey = "事件_33_私宅视频后离家";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === true &&
    eventDone("事件_E033") === true &&
    eventDone("事件_E034") === false &&
    scoreAtLeast(eventDlRaw, 950)
  ) {
    eventKey = "事件_34_王授军溺水";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === true &&
    eventDone("事件_E033") === true &&
    eventDone("事件_E034") === true &&
    eventDone("事件_E035") === false &&
    scoreAtLeast(eventDlRaw, 950)
  ) {
    eventKey = "事件_35_王授军活丧";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === true &&
    eventDone("事件_E033") === true &&
    eventDone("事件_E034") === true &&
    eventDone("事件_E035") === true &&
    eventDone("事件_E048") === false &&
    endingRouteTerminal === true
  ) {
    eventKey = "事件_48_AM_证据成立";
  } else if (
    eventDone("事件_E001") === true &&
    eventDone("事件_E002") === true &&
    eventDone("事件_E003") === true &&
    eventDone("事件_E004") === true &&
    eventDone("事件_E005") === true &&
    eventDone("事件_E006") === true &&
    eventDone("事件_E008") === true &&
    eventDone("事件_E009") === true &&
    eventDone("事件_E010") === true &&
    eventDone("事件_E011") === true &&
    eventDone("事件_E012") === true &&
    eventDone("事件_E013") === true &&
    eventDone("事件_E014") === true &&
    eventDone("事件_E015") === true &&
    eventDone("事件_E016") === true &&
    eventDone("事件_E017") === true &&
    eventDone("事件_E018") === true &&
    eventDone("事件_E019") === true &&
    eventDone("事件_E020") === true &&
    eventDone("事件_E021") === true &&
    eventDone("事件_E022") === true &&
    eventDone("事件_E023") === true &&
    eventDone("事件_E024") === true &&
    eventDone("事件_E025") === true &&
    eventDone("事件_E026") === true &&
    eventDone("事件_E027") === true &&
    eventDone("事件_E028") === true &&
    eventDone("事件_E029") === true &&
    eventDone("事件_E030") === true &&
    eventDone("事件_E031") === true &&
    eventDone("事件_E032") === true &&
    eventDone("事件_E033") === true &&
    eventDone("事件_E034") === true &&
    eventDone("事件_E035") === true &&
    eventDone("事件_E048") === true &&
    eventDone("事件_E049") === false
  ) {
    eventKey = "事件_49_AM_秘密摊牌";
  }

  if (
    !eventKey &&
    eventE035Raw === true &&
    eventE048Raw === false &&
    validEndingRoute(endingRouteRaw) &&
    validEndingStage(endingStageRaw)
  ) {
    if (endingRouteRaw === "结局三_隔离守婚") {
      if (endingStageRaw === "Z001") {
        endingStageKey = "终局阶段_Z003_骨折隔离";
      } else if (endingStageRaw === "Z003") {
        endingStageKey = "终局阶段_Z004_艾沫沫告别信";
      } else if (
        [
          "Z000",
          "Z002",
          "Z005",
          "Z006",
          "Z007",
          "Z008",
          "Z009",
          "Z010",
          "Z011",
          "Z012",
          "Z013",
        ].includes(endingStageRaw)
      ) {
        endingStageKey = "终局阶段_Z001_林茜清空硬盘";
      }
    } else if (endingRouteRaw === "结局二_三人共处") {
      if (
        ["Z000", "Z001", "Z003", "Z004"].includes(endingStageRaw) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z002_硬盘已经清空";
      } else if (endingStageRaw === "Z002" && scoreAtLeast(eventDlRaw, 950)) {
        endingStageKey = "终局阶段_Z005_杨桃子最终返乡";
      } else if (endingStageRaw === "Z006") {
        endingStageKey = "终局阶段_Z007_艾沫沫日记";
      } else if (
        ["Z005", "Z008", "Z009", "Z010", "Z011", "Z012", "Z013"].includes(
          endingStageRaw,
        )
      ) {
        endingStageKey = "终局阶段_Z006_火车站拦截";
      }
    } else if (endingRouteRaw === "结局一_离婚") {
      if (
        ["Z000", "Z001", "Z003", "Z004"].includes(endingStageRaw) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z002_硬盘已经清空";
      } else if (endingStageRaw === "Z002" && scoreAtLeast(eventDlRaw, 950)) {
        endingStageKey = "终局阶段_Z005_杨桃子最终返乡";
      } else if (endingStageRaw === "Z008") {
        endingStageKey = "终局阶段_Z010_Z013_离婚纠缠";
      } else if (endingStageRaw === "Z010") {
        endingStageKey = "终局阶段_Z011_下药坦白";
      } else if (endingStageRaw === "Z011") {
        endingStageKey = "终局阶段_Z012_遗物思念";
      } else if (
        ["Z005", "Z006", "Z007", "Z009", "Z013"].includes(endingStageRaw) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z008_摊牌";
      }
    } else if (endingRouteRaw === "双向出轨") {
      if (
        ["Z000", "Z001", "Z003", "Z004"].includes(endingStageRaw) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z002_硬盘已经清空";
      } else if (endingStageRaw === "Z002" && scoreAtLeast(eventDlRaw, 950)) {
        endingStageKey = "终局阶段_Z005_杨桃子最终返乡";
      } else if (endingStageRaw === "Z009") {
        endingStageKey = "终局阶段_Z010_Z013_离婚纠缠";
      } else if (
        ["Z005", "Z006", "Z007", "Z008", "Z010", "Z011", "Z012"].includes(
          endingStageRaw,
        )
      ) {
        endingStageKey = "终局阶段_Z009_双向出轨";
      }
    } else if (endingRouteRaw === "未定") {
      if (
        ["Z000", "Z001", "Z003", "Z004"].includes(endingStageRaw) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z002_硬盘已经清空";
      } else if (endingStageRaw === "Z002" && scoreAtLeast(eventDlRaw, 950)) {
        endingStageKey = "终局阶段_Z005_杨桃子最终返乡";
      } else if (
        [
          "Z005",
          "Z006",
          "Z007",
          "Z009",
          "Z010",
          "Z011",
          "Z012",
          "Z013",
        ].includes(endingStageRaw) &&
        scoreAtLeast(eventGwRaw, 820) &&
        scoreAtLeast(eventDlRaw, 950)
      ) {
        endingStageKey = "终局阶段_Z008_摊牌";
      }
    }
  }

  var eventStateA1LimitValue = stateA1Limit(eventDlRaw);

  if (eventE003Raw === true) {
    print(await getwi(controllerWorldbook, "地点_林茜家_监控布局"));
  }

  if (eventE013Raw === true && eventE029Raw === false) {
    print(await getwi(controllerWorldbook, "地点状态_用户公司_剥削挂墙"));
  }

  if (eventE029Raw === true) {
    print(await getwi(controllerWorldbook, "地点状态_用户公司_剥削已拆除"));
  }

  if (eventE013Raw === true) {
    print(await getwi(controllerWorldbook, "地点状态_家电城_繁衍挂墙"));
  }

  if (eventE020Raw === true) {
    print(await getwi(controllerWorldbook, "刺激作用_画作繁衍"));
  }

  if (eventE032Raw === true) {
    print(await getwi(controllerWorldbook, "终局路线变量规则"));
  }

  var eventDailyKeys = [];
  var eventD001Eligible =
    validDate(eventDateRaw) &&
    validDate(eventD001RecordDateRaw) &&
    eventD001RecordDateRaw !== eventDateRaw;

  var eventStateA1Valid =
    validDate(eventDateRaw) &&
    validDate(eventStateA1DateRaw) &&
    typeof eventStateA1CountRaw === "number" &&
    Number.isInteger(eventStateA1CountRaw) &&
    eventStateA1CountRaw >= 0 &&
    eventStateA1CountRaw <= 9 &&
    eventStateA1LimitValue !== null;

  if (!eventKey && !endingStageKey) {
    if (eventD001Eligible) {
      eventDailyKeys.push("日常事件_日常饮料");
    }

    if (eventStateA1Valid) {
      var eventStateA1Count =
        eventStateA1DateRaw === eventDateRaw ? eventStateA1CountRaw : 0;
      var eventStateA1SlotsLeft = Math.max(
        0,
        eventStateA1LimitValue - eventStateA1Count,
      );
      var eventStateA1Keys = [];

      if (
        scoreAtLeast(eventDlRaw, 60) &&
        nonIsolationCommonComplete === false
      ) {
        eventStateA1Keys.push("日常事件_秘密通讯_杨桃子邀约");
      }
      if (eventE018Raw === true && eventE034Raw === false) {
        eventStateA1Keys.push("日常事件_秘密通讯_熊猫人动图");
      }

      eventDailyKeys.push(...eventStateA1Keys.slice(0, eventStateA1SlotsLeft));
    }
  }

  if (eventKey) {
    print(await getwi(controllerWorldbook, eventKey));
  } else if (endingStageKey) {
    print(await getwi(controllerWorldbook, endingStageKey));
  } else {
    for (
      var eventDailyIndex = 0;
      eventDailyIndex < eventDailyKeys.length;
      eventDailyIndex++
    ) {
      print(await getwi(controllerWorldbook, eventDailyKeys[eventDailyIndex]));
    }
  }
}

async function render122(runtime) {
  const { charLoreBook, getvar, getwi, print } = runtime;
  var controllerWorldbook = charLoreBook || "林茜_世界书_v1.3.32";
  var openingMode = getvar("stat_data.世界.开局模式");

  var premiseMap = {
    默认拆迁旧楼: "开局前提_默认拆迁旧楼",
    旧楼电话纠缠: "开局前提_旧楼电话纠缠",
    原始首次撞见: "开局前提_原始首次撞见",
    远程监控: "开局前提_远程监控",
    画室监控: "开局前提_画室监控",
    "302监控": "开局前提_302监控",
    王授军私宅3P: "开局前提_王授军私宅3P",
    黑哥逃脱: "开局前提_黑哥逃脱",
    跪倒屈服: "开局前提_跪倒屈服",
    繁衍: "开局前提_繁衍",
    画室赴约: "开局前提_画室赴约",
  };

  var premiseKey =
    typeof openingMode === "string"
      ? premiseMap[openingMode.trim()]
      : undefined;

  if (premiseKey) {
    print(await getwi(controllerWorldbook, premiseKey));
  }
}

const controllers = new Map([
  [104, render104],
  [106, render106],
  [107, render107],
  [122, render122],
]);

export async function renderController({ entryId, variables, characterBook }) {
  const controller = controllers.get(entryId);
  if (!controller)
    throw new RangeError(`Unknown controller entryId: ${entryId}`);
  const runtime = createRuntime(variables, characterBook);
  await controller(runtime);
  return runtime.result();
}
