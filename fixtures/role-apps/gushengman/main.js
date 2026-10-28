const POSITION_NAMES = { L: "left", C: "center", R: "right" };
const EMPTY_CHARACTER = () => ({ name: null, sprite: null, distance: "normal" });
const TRANSIENT_ACTIONS = {
  shake: "motion-shake",
  jump_up: "motion-up",
  jump_down: "motion-down",
};

function readVariable(variables, path, fallback) {
  let value = variables;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !(part in value)) return fallback;
    value = value[part];
  }
  return value ?? fallback;
}

function numericVariable(variables, path, fallback) {
  const raw = readVariable(variables, path, fallback);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function cleanScript(source) {
  const text = String(source || "")
    .replace(/```(?:galgame)?/gi, "")
    .replace(/```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const opening = text.search(/<gametext>/i);
  if (opening < 0) return { text, wrapped: false };
  const body = text.slice(opening).replace(/^<gametext>/i, "");
  const closing = body.search(/<\/gametext>/i);
  return { text: closing < 0 ? body : body.slice(0, closing), wrapped: true };
}

function cloneStage(stage) {
  return {
    background: stage.background,
    location: stage.location,
    cg: stage.cg,
    bgm: stage.bgm,
    effect: stage.effect,
    waitMs: stage.waitMs,
    characters: Object.fromEntries(
      Object.entries(stage.characters).map(([position, character]) => [
        position,
        { ...character },
      ]),
    ),
  };
}

function findCharacterPosition(stage, target) {
  const upper = String(target || "").toUpperCase();
  if (POSITION_NAMES[upper]) return upper;
  return Object.keys(stage.characters).find(
    (position) => stage.characters[position].name === target,
  );
}

function showCharacter(stage, name, position, sprite) {
  let targetPosition = String(position || "").toUpperCase();
  let targetSprite = sprite;
  if (!POSITION_NAMES[targetPosition]) {
    targetSprite = position;
    targetPosition = findCharacterPosition(stage, name) || "C";
  }

  for (const candidate of Object.keys(stage.characters)) {
    if (candidate !== targetPosition && stage.characters[candidate].name === name) {
      stage.characters[candidate] = EMPTY_CHARACTER();
    }
  }

  const previous = stage.characters[targetPosition];
  const inherited = ["", "-", "同上"].includes(String(targetSprite || ""));
  const hidden = ["无", "none", "null"].includes(
    String(targetSprite || "").toLowerCase(),
  );
  stage.characters[targetPosition] = {
    name,
    sprite: hidden ? null : inherited ? previous.sprite : targetSprite,
    distance: previous.name === name ? previous.distance : "normal",
  };
}

function applyAction(stage, target, action) {
  const position = findCharacterPosition(stage, target);
  if (!position) return;
  if (action === "near" || action === "away") {
    stage.characters[position].distance = action;
  }
}

function applyCommand(stage, command, args, frames) {
  switch (command) {
    case "bg":
      stage.background = args[0] || null;
      stage.location = args[0] || "";
      stage.cg = null;
      break;
    case "show":
    case "alter":
      showCharacter(stage, args[0], args[1], args[2]);
      break;
    case "hide":
    case "leave": {
      const position = findCharacterPosition(stage, args[0]);
      if (position) stage.characters[position] = EMPTY_CHARACTER();
      break;
    }
    case "hide_all":
      stage.characters = { L: EMPTY_CHARACTER(), C: EMPTY_CHARACTER(), R: EMPTY_CHARACTER() };
      break;
    case "cg":
      stage.cg = args[0] || null;
      break;
    case "hide_cg":
      stage.cg = null;
      break;
    case "bgm":
      stage.bgm = args[0] || null;
      break;
    case "stop_bgm":
      stage.bgm = null;
      break;
    case "effect":
      stage.effect = args[0] || null;
      break;
    case "action":
      applyAction(stage, args[0], args[1]);
      if (frames.length && TRANSIENT_ACTIONS[args[1]]) {
        frames[frames.length - 1].action = {
          target: args[0],
          name: args[1],
        };
      }
      break;
    case "choice":
      if (!frames.length) {
        frames.push({
          speaker: "",
          text: "",
          stage: cloneStage(stage),
          choices: [],
          action: null,
        });
      }
      frames[frames.length - 1].choices = args.filter(Boolean).slice(0, 5);
      break;
    case "wait":
      stage.waitMs = Math.max(0, Number(args[0]) * 1000 || 500);
      break;
  }
}

export function parseGalgame(source) {
  const cleaned = cleanScript(source);
  if ("<gametext>".startsWith(cleaned.text)) return [];
  if (!cleaned.wrapped) {
    const paragraphs = cleaned.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    return paragraphs.map((text) => ({
      speaker: "",
      text,
      stage: {
        background: null,
        location: "",
        cg: null,
        bgm: null,
        effect: null,
        waitMs: 0,
        characters: { L: EMPTY_CHARACTER(), C: EMPTY_CHARACTER(), R: EMPTY_CHARACTER() },
      },
      choices: [],
      action: null,
    }));
  }

  const stage = {
    background: null,
    location: "",
    cg: null,
    bgm: null,
    effect: null,
    waitMs: 0,
    characters: { L: EMPTY_CHARACTER(), C: EMPTY_CHARACTER(), R: EMPTY_CHARACTER() },
  };
  const frames = [];

  for (const rawLine of cleaned.text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || "</gametext>".startsWith(line)) continue;
    const commandMatch = line.match(/^\[([^\]]+)\]$/);
    if (commandMatch) {
      const [command, ...args] = commandMatch[1].split("|").map((part) => part.trim());
      applyCommand(stage, command, args, frames);
      continue;
    }

    if (line.startsWith("[")) continue;

    const dialogue = line.match(/^([^|]*)\|([^|]*)\|([^|]*)\|([\s\S]*)$/);
    if (!dialogue) {
      if (frames.length) frames[frames.length - 1].text += "\n" + line;
      continue;
    }
    let text = dialogue[4].trim();
    let action = null;
    const actionMatch = text.match(/^(.*)\[action\|([^|\]]+)\|([^|\]]+)(?:\|[^\]]*)?\]$/);
    if (actionMatch) {
      text = actionMatch[1].trim();
      action = { target: actionMatch[2].trim(), name: actionMatch[3].trim() };
      applyAction(stage, action.target, action.name);
    }

    const speaker = dialogue[1].trim() || "旁白";
    const position = dialogue[2].trim();
    const sprite = dialogue[3].trim();
    if (speaker !== "旁白" && position && !["无", "none", "null"].includes(sprite.toLowerCase())) {
      showCharacter(stage, speaker, position, sprite);
    }
    frames.push({
      speaker: speaker === "旁白" ? "" : speaker,
      text,
      stage: cloneStage(stage),
      choices: [],
      action,
      delayMs: stage.waitMs,
    });
    stage.waitMs = 0;
  }
  return frames;
}

export function mount({ api }) {
  const view = api.ui.register("gushengman-stage", {
    elements: {
      stage: { selector: "[data-stage]", kind: "container" },
      background: { selector: "[data-background]", kind: "image" },
      characterLeft: { selector: "[data-character-left]", kind: "image" },
      characterCenter: { selector: "[data-character-center]", kind: "image" },
      characterRight: { selector: "[data-character-right]", kind: "image" },
      cgContainer: { selector: "[data-cg-container]", kind: "container" },
      cg: { selector: "[data-cg]", kind: "image" },
      location: { selector: "[data-location]", kind: "text" },
      dialogue: { selector: "[data-dialogue]", kind: "container" },
      speaker: { selector: "[data-speaker]", kind: "text" },
      text: { selector: "[data-text]", kind: "text" },
      page: { selector: "[data-page]", kind: "text" },
      status: { selector: "[data-status]", kind: "container" },
      affection: { selector: "[data-affection]", kind: "progress" },
      affectionValue: { selector: "[data-affection-value]", kind: "text" },
      composition: { selector: "[data-composition]", kind: "progress" },
      compositionValue: { selector: "[data-composition-value]", kind: "text" },
      melody: { selector: "[data-melody]", kind: "text" },
      voice: { selector: "[data-voice]", kind: "text" },
      time: { selector: "[data-time]", kind: "text" },
      worldLocation: { selector: "[data-world-location]", kind: "text" },
      event: { selector: "[data-event]", kind: "text" },
      turnDelta: { selector: "[data-turn-delta]", kind: "text" },
      choices: { selector: "[data-choices]", kind: "container" },
      inputPanel: { selector: "[data-input-panel]", kind: "container" },
      feedback: { selector: "[data-feedback]", kind: "text" },
      displayPanel: { selector: "[data-display-panel]", kind: "container" },
      gallery: { selector: "[data-gallery]", kind: "container" },
      galleryViewer: { selector: "[data-gallery-viewer]", kind: "container" },
      galleryViewerImage: { selector: "[data-gallery-viewer-image]", kind: "image" },
      ...Object.fromEntries(
        Array.from({ length: 14 }, (_, index) => [
          [`galleryItem${index}`, { selector: `[data-gallery-item-${index}]`, kind: "container" }],
          [`galleryThumb${index}`, { selector: `[data-gallery-thumb-${index}]`, kind: "image" }],
        ]).flat(),
      ),
    },
  });

  const controls = api.ui.register("gushengman-controls", {
    elements: {
      back: { selector: "[data-back]", kind: "control" },
      next: { selector: "[data-next]", kind: "control" },
      hide: { selector: "[data-hide]", kind: "control" },
      bgm: { selector: "[data-bgm]", kind: "control" },
      display: { selector: "[data-display]", kind: "control" },
      displayClose: { selector: "[data-display-close]", kind: "control" },
      fontSlider: { selector: "[data-font-slider]", kind: "control" },
      characterSlider: { selector: "[data-character-slider]", kind: "control" },
      statusToggle: { selector: "[data-status-toggle]", kind: "control" },
      statusClose: { selector: "[data-status-close]", kind: "control" },
      galleryOpen: { selector: "[data-gallery-open]", kind: "control" },
      galleryClose: { selector: "[data-gallery-close]", kind: "control" },
      galleryViewerClose: { selector: "[data-gallery-viewer-close]", kind: "control" },
      auto: { selector: "[data-auto]", kind: "control" },
      skip: { selector: "[data-skip]", kind: "control" },
      inputOpen: { selector: "[data-input-open]", kind: "control" },
      inputClose: { selector: "[data-input-close]", kind: "control" },
      input: { selector: "[data-input]", kind: "control" },
      send: { selector: "[data-send]", kind: "control" },
      choice0: { selector: "[data-choice-0]", kind: "control" },
      choice1: { selector: "[data-choice-1]", kind: "control" },
      choice2: { selector: "[data-choice-2]", kind: "control" },
      choice3: { selector: "[data-choice-3]", kind: "control" },
      choice4: { selector: "[data-choice-4]", kind: "control" },
      ...Object.fromEntries(
        Array.from({ length: 14 }, (_, index) => [
          `gallerySelect${index}`,
          { selector: `[data-gallery-select-${index}]`, kind: "control" },
        ]),
      ),
    },
  });

  const aliases = api.data.get("assetAliases");
  const availableAssets = new Set(api.assets.list().map((asset) => asset.id));
  let frames = [];
  let pageIndex = 0;
  let autoMode = false;
  let dialogueHidden = false;
  let statusOpen = false;
  let input = "";
  let sending = false;
  let playing = false;
  let playingAsset = null;
  let activeStream = null;
  let readTicket = 0;
  let motionCancel = null;
  let effectCancel = null;
  let typingCancel = null;
  let delayedTypingCancel = null;
  let typingText = "";
  let galleryOpen = false;
  const unlockedCGs = new Set();
  const cgAliases = Object.keys(aliases.cg).slice(0, 14);

  function assetFor(kind, alias) {
    const id = alias && aliases[kind] ? aliases[kind][alias] : null;
    return id && availableAssets.has(id) ? id : null;
  }

  function currentFrame() {
    return frames[pageIndex] || null;
  }

  function characterPatch(position, speaker) {
    const character = currentFrame()?.stage.characters[position];
    const asset = character ? assetFor("sprite", character.sprite) : null;
    return {
      visible: Boolean(asset),
      ...(asset ? { asset, alt: character.name || "角色立绘" } : {}),
      classes: {
        dimmed: Boolean(character?.name && speaker && character.name !== speaker),
        near: character?.distance === "near",
        away: character?.distance === "away",
        "motion-shake": false,
        "motion-up": false,
        "motion-down": false,
      },
    };
  }

  function showFeedback(message) {
    view.update({ feedback: { text: String(message || "") } });
  }

  async function syncMusic(frame) {
    const wanted = assetFor("bgm", frame?.stage.bgm);
    controls.update({
      bgm: { text: frame?.stage.bgm ? `BGM · ${frame.stage.bgm}` : "BGM" },
    });
    if (!playing) return;
    if (!wanted) {
      api.media.stop("gushengman-bgm");
      playing = false;
      playingAsset = null;
      controls.update({ bgm: { classes: { active: false } } });
      return;
    }
    if (wanted === playingAsset) return;
    try {
      await api.media.play({ asset: wanted, channel: "gushengman-bgm", loop: true, volume: 0.5 });
      playingAsset = wanted;
    } catch (error) {
      playing = false;
      playingAsset = null;
      controls.update({ bgm: { classes: { active: false } } });
      showFeedback(error.message);
    }
  }

  function triggerMotion(frame) {
    if (motionCancel) motionCancel();
    const actionClass = TRANSIENT_ACTIONS[frame?.action?.name];
    const position = frame?.action ? findCharacterPosition(frame.stage, frame.action.target) : null;
    if (!actionClass || !position) return;
    const element = `character${POSITION_NAMES[position][0].toUpperCase()}${POSITION_NAMES[position].slice(1)}`;
    view.update({ [element]: { classes: { [actionClass]: true } } });
    motionCancel = api.timers.after(520, () => {
      view.update({ [element]: { classes: { [actionClass]: false } } });
      motionCancel = null;
    });
  }

  function triggerEffect(frame) {
    if (effectCancel) effectCancel();
    const flash = frame?.stage.effect === "screen_flash";
    const black = ["fade_to_black"].includes(frame?.stage.effect);
    view.update({ stage: { classes: { "effect-flash": flash, "effect-black": black } } });
    if (flash) {
      effectCancel = api.timers.after(280, () => {
        view.update({ stage: { classes: { "effect-flash": false } } });
        effectCancel = null;
      });
    }
  }

  function renderChoices(frame) {
    const choices = frame?.choices || [];
    view.update({ choices: { visible: choices.length > 0 } });
    const patch = {};
    for (let index = 0; index < 5; index += 1) {
      patch[`choice${index}`] = {
        visible: Boolean(choices[index]),
        text: choices[index] || "",
        disabled: sending,
      };
    }
    controls.update(patch);
  }

  function finishTypewriter() {
    const wasPending = Boolean(typingCancel || delayedTypingCancel);
    if (delayedTypingCancel) delayedTypingCancel();
    delayedTypingCancel = null;
    if (typingCancel) typingCancel();
    typingCancel = null;
    if (!wasPending) return false;
    view.update({ text: { text: typingText } });
    return true;
  }

  function startTypewriter(text) {
    finishTypewriter();
    typingText = String(text || "");
    const characters = Array.from(typingText);
    if (!characters.length) return;
    let count = 0;
    typingCancel = api.timers.every(api.data.get("typewriterSpeedMs"), () => {
      count += 1;
      view.update({ text: { text: characters.slice(0, count).join("") } });
      if (count >= characters.length) {
        typingCancel();
        typingCancel = null;
      }
    });
  }

  function scheduleTypewriter(frame) {
    typingText = String(frame.text || "");
    if (!frame.delayMs) {
      startTypewriter(typingText);
      return;
    }
    delayedTypingCancel = api.timers.after(frame.delayMs, () => {
      delayedTypingCancel = null;
      startTypewriter(typingText);
    });
  }

  function renderGallery() {
    const viewPatch = {};
    const controlPatch = {};
    for (let index = 0; index < 14; index += 1) {
      const alias = cgAliases[index];
      const asset = assetFor("cg", alias);
      const unlocked = Boolean(alias && asset && unlockedCGs.has(alias));
      viewPatch[`galleryItem${index}`] = { visible: Boolean(alias) };
      viewPatch[`galleryThumb${index}`] = {
        visible: unlocked,
        ...(unlocked ? { asset, alt: alias } : {}),
      };
      controlPatch[`gallerySelect${index}`] = {
        visible: Boolean(alias),
        text: unlocked ? alias : `未解锁 · ${alias || ""}`,
        disabled: !unlocked,
      };
    }
    view.update(viewPatch);
    controls.update(controlPatch);
  }

  function render({ typewrite = true } = {}) {
    const frame = currentFrame();
    finishTypewriter();
    if (!frame) {
      view.update({
        text: { text: "" },
        speaker: { text: "", visible: false },
        page: { text: "" },
        choices: { visible: false },
      });
      controls.update({ back: { disabled: true }, next: { disabled: true } });
      return;
    }

    const background = assetFor("background", frame.stage.background);
    const cg = assetFor("cg", frame.stage.cg);
    view.update({
      background: {
        visible: Boolean(background),
        ...(background ? { asset: background, alt: frame.stage.location || "场景背景" } : {}),
      },
      characterLeft: characterPatch("L", frame.speaker),
      characterCenter: characterPatch("C", frame.speaker),
      characterRight: characterPatch("R", frame.speaker),
      cgContainer: { visible: Boolean(cg) },
      cg: { visible: Boolean(cg), ...(cg ? { asset: cg, alt: frame.stage.cg } : {}) },
      location: { text: frame.stage.location || "", visible: Boolean(frame.stage.location) },
      speaker: { text: frame.speaker, visible: Boolean(frame.speaker) },
      text: { text: typewrite ? "" : frame.text },
      page: { text: `${pageIndex + 1} / ${frames.length}` },
    });
    controls.update({
      back: { disabled: pageIndex === 0 || sending },
      next: { disabled: pageIndex >= frames.length - 1 || sending || frame.choices.length > 0 },
      skip: { disabled: pageIndex >= frames.length - 1 || sending },
    });
    renderChoices(frame);
    triggerMotion(frame);
    triggerEffect(frame);
    syncMusic(frame);
    if (frame.stage.cg) {
      unlockedCGs.add(frame.stage.cg);
      if (galleryOpen) renderGallery();
    }
    if (typewrite) scheduleTypewriter(frame);

    const missing = [
      frame.stage.background && !background ? `背景“${frame.stage.background}”` : null,
      frame.stage.cg && !cg ? `CG“${frame.stage.cg}”` : null,
      ...Object.values(frame.stage.characters).map((character) =>
        character.sprite && !assetFor("sprite", character.sprite) ? `立绘“${character.sprite}”` : null,
      ),
    ].filter(Boolean);
    showFeedback(missing.length ? `素材库中没有${missing.join("、")}。你可以继续阅读；若此资源应随角色包提供，请联系角色包维护者。` : "");
  }

  function renderDocument(text, position = "start", typewrite = true) {
    frames = parseGalgame(text);
    pageIndex = position === "end" ? Math.max(0, frames.length - 1) : 0;
    render({ typewrite });
  }

  function renderStatus(record) {
    const variables = record.variables || {};
    const affection = numericVariable(variables, "顾声慢.情感连结度", null);
    const composition = numericVariable(variables, "顾声慢.创作完成度", null);
    view.update({
      affection: { value: affection ?? 0, max: 100 },
      affectionValue: { text: affection === null ? "未提供" : String(affection) },
      composition: { value: composition ?? 0, max: 100 },
      compositionValue: { text: composition === null ? "未提供" : String(composition) },
      melody: { text: String(readVariable(variables, "顾声慢.心象映射.当前脑内旋律", "未提供")) },
      voice: { text: String(readVariable(variables, "顾声慢.心象映射.当前心声", "未提供")) },
      time: { text: String(readVariable(variables, "世界.当前时间", "未提供")) },
      worldLocation: { text: String(readVariable(variables, "世界.当前地址", "未提供")) },
      event: { text: String(readVariable(variables, "世界.事件状态", "未提供")) },
    });
  }

  async function renderFloorDelta(record, ticket) {
    if (!record.floorId) {
      view.update({ turnDelta: { text: "" } });
      return;
    }
    try {
      const floor = await api.variables.getFloor({
        branchId: record.branchId,
        floorId: record.floorId,
        attemptId: record.attemptId,
      });
      if (ticket !== readTicket) return;
      const before = floor.before.variables || {};
      const after = floor.after.variables || {};
      const beforeAffection = numericVariable(before, "顾声慢.情感连结度", null);
      const afterAffection = numericVariable(after, "顾声慢.情感连结度", null);
      const beforeComposition = numericVariable(before, "顾声慢.创作完成度", null);
      const afterComposition = numericVariable(after, "顾声慢.创作完成度", null);
      const changes = [];
      for (const [label, previous, next] of [
        ["情感连结度", beforeAffection, afterAffection],
        ["创作完成度", beforeComposition, afterComposition],
      ]) {
        if (previous !== null && next !== null) {
          const delta = next - previous;
          changes.push(`${label}${delta ? ` ${delta > 0 ? "+" : ""}${delta}` : "未变化"}`);
        }
      }
      view.update({ turnDelta: { text: changes.length ? `本轮：${changes.join("，")}` : "" } });
    } catch (error) {
      if (ticket === readTicket) view.update({ turnDelta: { text: error.message } });
    }
  }

  api.variables.watch("view", (record) => {
    const ticket = ++readTicket;
    renderStatus(record);
    renderFloorDelta(record, ticket);
    if (!record.floorId) {
      activeStream = null;
      renderDocument(api.data.get("opening"), "start");
      return;
    }
    api.messages
      .getFloor({
        branchId: record.branchId,
        floorId: record.floorId,
        attemptId: record.attemptId,
      })
      .then((messages) => {
        if (ticket !== readTicket) return;
        const text = messages
          .filter((message) => message.role === "assistant")
          .map((message) => message.text)
          .join("\n\n");
        activeStream = null;
        renderDocument(text, "start");
      })
      .catch((error) => {
        if (ticket === readTicket) showFeedback(error.message);
      });
  });

  api.messages.onTextStream((event) => {
    if (event.jobId) return;
    const current = api.variables.get("current");
    const selected = api.variables.get("view");
    if (current.snapshotId !== selected.snapshotId) return;
    readTicket += 1;
    if (activeStream !== event.streamId) activeStream = event.streamId;
    renderDocument(event.text, "end", false);
    if (event.status === "failed" && event.error) showFeedback(event.error.message);
  });

  function move(delta) {
    pageIndex = Math.max(0, Math.min(frames.length - 1, pageIndex + delta));
    render();
  }

  controls.on("back", "click", () => {
    finishTypewriter();
    move(-1);
  });
  controls.on("next", "click", () => {
    if (finishTypewriter()) return;
    move(1);
  });
  controls.on("skip", "click", () => {
    pageIndex = Math.max(0, frames.length - 1);
    autoMode = false;
    controls.update({ auto: { text: "Auto", classes: { active: false } } });
    render({ typewrite: false });
  });
  controls.on("auto", "click", () => {
    autoMode = !autoMode;
    controls.update({ auto: { text: autoMode ? "Auto ●" : "Auto", classes: { active: autoMode } } });
  });
  api.timers.every(api.data.get("autoDelayMs"), () => {
    if (autoMode && !typingCancel && !delayedTypingCancel && !sending && currentFrame() && !currentFrame().choices.length && pageIndex < frames.length - 1) {
      move(1);
    }
  });

  controls.on("hide", "click", () => {
    dialogueHidden = !dialogueHidden;
    view.update({ stage: { classes: { "dialogue-hidden": dialogueHidden } } });
    controls.update({ hide: { text: dialogueHidden ? "显示" : "隐藏" } });
  });
  view.on("stage", "click", (event) => {
    if (event.target.closest("button, textarea, input, aside")) return;
    if (dialogueHidden) {
      dialogueHidden = false;
      view.update({ stage: { classes: { "dialogue-hidden": false } } });
      controls.update({ hide: { text: "隐藏" } });
      return;
    }
    if (finishTypewriter()) return;
    if (currentFrame()?.choices.length || pageIndex >= frames.length - 1) return;
    move(1);
  });
  view.on("stage", "dblclick", (event) => {
    if (!document.fullscreenElement && event.currentTarget.requestFullscreen) {
      event.currentTarget.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  });

  function setStatus(open) {
    statusOpen = open;
    view.update({ status: { visible: open } });
    controls.update({ statusToggle: { classes: { active: open } } });
  }
  controls.on("statusToggle", "click", () => setStatus(!statusOpen));
  controls.on("statusClose", "click", () => setStatus(false));

  controls.on("display", "click", () => view.update({ displayPanel: { visible: true } }));
  controls.on("displayClose", "click", () => view.update({ displayPanel: { visible: false } }));

  function applySliderClasses(prefix, value, minimum, maximum) {
    const selected = Math.max(minimum, Math.min(maximum, Math.round(Number(value) / 10) * 10));
    const classes = {};
    for (let candidate = minimum; candidate <= maximum; candidate += 10) {
      classes[`${prefix}-${candidate}`] = candidate === selected;
    }
    view.update({ stage: { classes } });
  }
  controls.on("fontSlider", "input", (event) => applySliderClasses("font", event.target.value, 70, 150));
  controls.on("characterSlider", "input", (event) => applySliderClasses("character", event.target.value, 60, 140));

  controls.on("galleryOpen", "click", () => {
    galleryOpen = true;
    renderGallery();
    view.update({ gallery: { visible: true } });
  });
  controls.on("galleryClose", "click", () => {
    galleryOpen = false;
    view.update({ gallery: { visible: false } });
  });
  controls.on("galleryViewerClose", "click", () => view.update({ galleryViewer: { visible: false } }));
  for (let index = 0; index < 14; index += 1) {
    controls.on(`gallerySelect${index}`, "click", () => {
      const alias = cgAliases[index];
      const asset = assetFor("cg", alias);
      if (!asset || !unlockedCGs.has(alias)) return;
      view.update({
        galleryViewer: { visible: true },
        galleryViewerImage: { visible: true, asset, alt: alias },
      });
    });
  }

  controls.on("bgm", "click", async () => {
    const asset = assetFor("bgm", currentFrame()?.stage.bgm);
    if (!asset) {
      showFeedback(currentFrame()?.stage.bgm ? `素材库中没有 BGM“${currentFrame().stage.bgm}”。可继续阅读，请联系角色包维护者补齐资源。` : "当前段落没有 BGM。" );
      return;
    }
    try {
      if (playing) {
        api.media.pause("gushengman-bgm");
        playing = false;
      } else {
        await api.media.play({ asset, channel: "gushengman-bgm", loop: true, volume: 0.5 });
        playing = true;
        playingAsset = asset;
      }
      controls.update({ bgm: { classes: { active: playing } } });
      showFeedback("");
    } catch (error) {
      showFeedback(error.message);
    }
  });

  function setInputPanel(open) {
    view.update({ inputPanel: { visible: open } });
  }
  controls.on("inputOpen", "click", () => setInputPanel(true));
  controls.on("inputClose", "click", () => setInputPanel(false));
  controls.on("input", "input", (event) => {
    input = event.target.value;
  });

  async function send(text) {
    const message = String(text || "").trim();
    if (!message || sending) return;
    let sendError = null;
    sending = true;
    controls.update({ send: { disabled: true } });
    renderChoices(currentFrame());
    showFeedback("");
    try {
      await api.history.latest();
      await api.chat.send({ text: message });
      input = "";
      controls.update({ input: { value: "" } });
      setInputPanel(false);
    } catch (error) {
      sendError = error;
      setInputPanel(true);
    } finally {
      sending = false;
      controls.update({ send: { disabled: false } });
      render({ typewrite: false });
      if (sendError) showFeedback(sendError.message);
    }
  }

  controls.on("send", "click", () => send(input));
  for (let index = 0; index < 5; index += 1) {
    controls.on(`choice${index}`, "click", () => send(currentFrame()?.choices[index]));
  }

  renderDocument(api.data.get("opening"), "start");
}
