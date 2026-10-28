// Reading state is local UI state. Generation stays in the shared chat controller.
let novelTimer = null;
let novelAudio = null;
let novelAudioSession = null;
function novelFrames(s) {
  return userVisibleMessages(s)
    .filter(
      (m) =>
        m.role === "assistant" &&
        (m.opening ||
          s.rounds.find((f) => f.id === m.floorId)?.state === "committed"),
    )
    .flatMap((m) =>
      messageDisplay(s, m)
        .text.split(/\n\s*\n/)
        .filter((t) => t.trim())
        .map((text, index) => ({
          id: m.id + ":" + index,
          messageId: m.id,
          floorId: m.floorId,
          text,
        })),
    );
}
function renderNovel(s, messages, composer) {
  clearTimeout(novelTimer);
  document.body.classList.add("role-stage-mode");
  const cfg = s.config.presentation;
  const frames = novelFrames(s);
  s.reading ??= {
    index: 0,
    hidden: false,
    history: false,
    status: false,
    auto: false,
    gallery: false,
  };
  const state = s.reading;
  state.index = Math.max(0, Math.min(state.index, frames.length - 1));
  if (state.index >= frames.length - 1) state.auto = false;
  const frame = frames[state.index];
  const record = roleRecord(
    s,
    frame ? s.rounds.find((f) => f.id === frame.floorId) : null,
  );
  const current = roleRecord(s, roleFloors(s).at(-1));
  if (novelAudioSession !== s.id) {
    novelAudio?.pause();
    novelAudio = null;
    novelAudioSession = s.id;
  }
  const host = document.createElement("section");
  host.className = "role-stage vn-host";
  host.innerHTML = `<div slot="scene" class="vn-scene" style="background-image:url('${roleAsset(record.config.media.background)}')">${record.config.media.portrait ? `<img src="${roleAsset(record.config.media.portrait)}" alt="${esc(record.config.characterName)}">` : ""}</div><div slot="narrative" class="vn-narrative" ${state.hidden ? "hidden" : ""}><strong>${esc(record.config.characterName)}</strong><div class="vn-text">${frame ? mdText(frame.text) : ""}</div><small>${frames.length ? `${state.index + 1} / ${frames.length}` : ""}</small></div><div slot="playback" class="vn-controls"><button data-vn="prev" ${state.index === 0 ? "disabled" : ""} title="上一段">◀</button><button data-vn="hide">${state.hidden ? "显示正文" : "隐藏正文"}</button><button data-vn="music">${novelAudio && !novelAudio.paused ? "关闭音乐" : "播放音乐"}</button><button data-vn="status">状态</button><button data-vn="history">历史</button><button data-vn="gallery">画廊</button><button data-vn="auto" ${frames.length < 2 ? "disabled" : ""}>${state.auto ? "停止自动阅读" : "自动阅读"}</button><button data-vn="skip" ${state.index >= frames.length - 1 ? "disabled" : ""}>跳至最新</button><button data-vn="next" ${state.index >= frames.length - 1 ? "disabled" : ""} title="下一段">▶</button></div><div slot="choices" class="vn-actions">${roleChoiceHTML(s, current, current)}</div><div slot="history" class="vn-history" ${state.history ? "" : "hidden"}><button data-vn="history">关闭历史</button></div><div slot="status" class="vn-overlay" ${state.status || state.gallery ? "" : "hidden"}><button data-vn="close">关闭</button><div class="vn-status-card"></div><div class="vn-gallery" ${state.gallery ? "" : "hidden"}>${cfg.novel.gallery.map((src) => `<img src="${roleAsset(src)}" alt="${esc(cfg.title)}">`).join("")}</div></div>`;
  const issue = validateRoleComposition(cfg);
  if (issue) throw Error(issue);
  host.attachShadow({ mode: "open" }).innerHTML =
    `<style>:host{display:block}*{box-sizing:border-box}${cfg.shell.css}</style>${cfg.shell.html}`;
  $("mainView").append(host);
  composer.slot = "composer";
  host.append(composer);
  host.querySelector(".vn-history").append(messages);
  host.querySelector(".vn-status-card").hidden = !state.status;
  if (state.status)
    mountRoleCard(host.querySelector(".vn-status-card"), record);
  const failure = messages.querySelector(":scope > p.danger");
  if (failure) host.querySelector(".vn-actions").prepend(failure);
  host.querySelectorAll("[data-vn]").forEach(
    (button) =>
      (button.onclick = async () => {
        const action = button.dataset.vn;
        if (action === "prev") {
          state.index--;
          state.auto = false;
        }
        if (action === "next") state.index++;
        if (action === "skip") {
          state.index = frames.length - 1;
          state.auto = false;
        }
        if (action === "hide") state.hidden = !state.hidden;
        if (action === "history") state.history = !state.history;
        if (action === "status") {
          state.status = !state.status;
          state.gallery = false;
        }
        if (action === "gallery") {
          state.gallery = !state.gallery;
          state.status = false;
        }
        if (action === "close") {
          state.gallery = false;
          state.status = false;
        }
        if (action === "auto") state.auto = !state.auto;
        if (action === "music") {
          novelAudio ??= new Audio(roleAsset(cfg.novel.bgm));
          novelAudio.loop = true;
          if (novelAudio.paused) await novelAudio.play();
          else novelAudio.pause();
        }
        render();
      }),
  );
  if (state.auto && state.index < frames.length - 1)
    novelTimer = setTimeout(() => {
      state.index++;
      render();
    }, cfg.novel.autoMs);
  else state.auto = false;
}
