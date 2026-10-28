const scenes = {
  c1: {
    layout: "library",
    title: "雨落旧书楼",
    place: "临安 · 旧书楼",
    time: "暮春 · 雨夜",
    object: "一封未署名的旧信",
    choices: [
      ["询问信的来处", "“这封信，是谁留下的？”"],
      ["看看书架", "“我想看看架上的旧书。”"],
    ],
  },
  c2: {
    layout: "library",
    title: "森林尽头的来信",
    place: "银叶森林 · 林间小径",
    time: "黄昏 · 微风",
    object: "古树上的刻痕",
    choices: [
      ["查看刻痕", "仔细查看树干上的刻痕。"],
      ["询问钟声", "“钟声是从哪里传来的？”"],
    ],
  },
  c4: {
    layout: "library",
    title: "第七封匿名信",
    place: "事务所 · 案件资料室",
    time: "深夜 · 暴雨",
    object: "尚未拆开的第七封信",
    choices: [
      ["查看第七封信", "戴上手套，查看第七封信。"],
      ["核对时间", "“我们再核对一下信上的时间。”"],
    ],
  },
  c5: {
    layout: "deck",
    title: "远航者号 · 领航台",
    place: "边缘星域 · 航线 E-07",
    time: "舰内时 02:14",
    object: "来自百年前的求救信号",
    choices: [
      ["查看星图", "“把信号来源标在星图上吧。”"],
      ["收听信号", "戴上耳机，仔细收听求救信号。"],
    ],
  },
  c6: {
    layout: "library",
    title: "山海有归期",
    place: "白鹭渡 · 渡口",
    time: "清晨 · 薄雾",
    object: "一张通往山门的地图",
    choices: [
      ["查看地图", "展开地图，查看通往山门的路线。"],
      ["问起旧友", "“你说的那位熟人，住在附近吗？”"],
    ],
  },
};

export function roleDelivery(card) {
  const scene = scenes[card.id];
  if (!scene) return { mode: "system_chat", assets: {}, data: {} };
  return {
    mode: "custom",
    assets: {},
    data: { scene },
    cssUrl: new URL("./role-view.css", import.meta.url).href,
    scriptUrl: new URL("./role-entry.mjs", import.meta.url).href,
    html: `<section class="role-surface ${scene.layout}" data-owner="card"><div class="ownership-label role-label">角色卡示例 · 场景与布局</div><aside class="scene"><div class="scene-art" aria-hidden="true">${card.symbol}</div><div class="scene-details"><span class="eyebrow">${card.kicker}</span><h2>${scene.title}</h2><p class="character-name">${card.name}</p><div class="scene-meta"><div><span>当前位置</span><strong id="place"></strong></div><div><span>场景时间</span><strong id="time"></strong></div><div><span>故事线索</span><strong id="object"></strong></div></div><p id="message-count"></p></div><div class="scene-options"><h3>接下来…</h3><button id="choice-one"></button><button id="choice-two"></button></div></aside><div class="chat-slot" id="chat-slot"></div></section>`,
  };
}
