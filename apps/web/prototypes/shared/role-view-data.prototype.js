window.RoleViewDefinition = {
  actionIcons: {
    "message-edit":
      '<path d="m4 16 1-4L15 2l4 4L9 16l-5 1Zm9-12 4 4M3 21h18"/>',
    "message-regenerate-edit":
      '<path d="M6 3v12m0-6h7a5 5 0 0 0 5-5M3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 3h6m-3-3v6"/>',
    "message-regenerate":
      '<path d="M6 3v12m0-6h7a5 5 0 0 0 5-5M3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 3h6m-3-3v6"/>',
    debug:
      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  },
  config: {
    css: "header { letter-spacing: .02em; }\n.clue p { line-height: 1.8; }",
    version: 1,
    layout: "stage",
    title: "灯塔来信",
    accent: "#b98952",
    meterKey: "relationship.trust",
    meterLabel: "信任",
    meterMax: 100,
    showChoices: true,
    bodyMarker: "[scene_state]",
    html: '<header><span>角色状态</span><strong data-bind="location"></strong></header><section class="status-grid"><img data-portrait alt="林岚"><div><label>时间</label><h2 data-bind="time"></h2><label data-bind="meterLabel"></label><h2 data-bind="meterValue"></h2><progress data-meter></progress></div></section><section class="clue"><label>线索</label><p data-bind="clue"></p></section>',
    bindings: {
      location: "scene.location",
      time: "scene.time",
      clue: "story.clue",
    },
  },
  initial: {
    "scene.location": "港口书店",
    "scene.time": "22:00",
    "relationship.trust": 0,
    "story.clue": "书店仍亮着灯。",
  },
  choices: [
    {
      id: "letter",
      title: "问起信件",
      text: "我指了指柜台上的信，问林岚这封信是谁寄来的。",
    },
    {
      id: "lighthouse",
      title: "聊聊旧灯塔",
      text: "我想知道旧灯塔发生过什么，请林岚继续讲下去。",
    },
    {
      id: "stay",
      title: "留在书店",
      text: "我收好雨伞，在窗边坐下，陪林岚整理书架。",
    },
    {
      id: "records",
      title: "寻找值夜记录",
      text: "我提议和林岚一起查找旧灯塔的值夜记录。",
    },
  ],
};

// Proposed presentation fixtures; existing HTTP response fixtures remain unchanged.
RoleViewDefinition.config.media = {
  background: "bookshop.svg",
  portrait: "linlan.svg",
  characterAvatar: "linlan.svg",
};
RoleViewDefinition.config.characterName = "林岚";
RoleViewDefinition.config.choices = structuredClone(
  RoleViewDefinition.choices,
).map((c) => ({ ...c, action: "send" }));
RoleViewDefinition.config.chatTheme = { surface: "#0e191edb", text: "#ece7d9" };
RoleViewDefinition.config.shell = {
  html: '<div class="composition"><section class="scene-region"><slot name="scene"></slot></section><section class="chat-region"><slot name="chat"></slot></section></div>',
  css: `.composition{height:100%;display:grid;grid-template-columns:minmax(280px,.9fr) minmax(460px,1.1fr)}.scene-region,.chat-region{display:flex;min-width:0;min-height:0}slot{display:contents}::slotted(.role-scene){flex:1}::slotted(.role-chat-pane){flex:1}@media(max-width:1000px){.composition{grid-template-columns:minmax(240px,.75fr) minmax(360px,1.25fr)}}@media(max-width:700px){.composition{height:auto;display:flex;flex-direction:column}.scene-region{min-height:610px}.chat-region{min-height:530px}}`,
};
RoleViewDefinition.config.scene = {
  html: '<div class="scene-content"><slot name="heading"></slot><slot name="portrait"></slot><slot name="status"></slot></div>',
  css: `.scene-content{position:relative;height:100%;min-height:100%}slot{display:contents}::slotted(.role-chapter){top:32px;left:32px}::slotted(.role-portrait){bottom:0;left:12%;height:82%}::slotted(.role-state-panel){bottom:18px;left:24px;right:24px}@media(max-width:700px){.scene-content{min-height:610px}::slotted(.role-chapter){top:20px;left:20px}::slotted(.role-portrait){height:245px;left:auto;right:18px;bottom:270px}::slotted(.role-state-panel){left:15px;right:15px;bottom:12px}}`,
};
RoleViewDefinition.performer = { name: "访客", avatar: "visitor.svg" };
RoleViewDefinition.variants = {
  bookshop: structuredClone(RoleViewDefinition.config),
  harbor: {
    ...structuredClone(RoleViewDefinition.config),
    title: "港湾夜话",
    accent: "#76bccc",
    media: {
      background: "harbor.svg",
      portrait: "linlan.svg",
      characterAvatar: "linlan.svg",
    },
    shell: {
      html: '<div class="composition"><section class="chat-region"><slot name="chat"></slot></section><section class="scene-region"><slot name="scene"></slot></section></div>',
      css: `.composition{height:100%;display:grid;grid-template-columns:minmax(460px,1.3fr) minmax(300px,.7fr);background:#071a2844}.scene-region,.chat-region{display:flex;min-width:0;min-height:0}slot{display:contents}::slotted(.role-scene){flex:1}::slotted(.role-chat-pane){flex:1;margin:20px}.topbar{display:none!important}@media(max-width:700px){.composition{height:auto;display:flex;flex-direction:column}.scene-region{min-height:610px;order:-1}.chat-region{min-height:530px}}`,
    },
    css: "header{background:#dbeff4}.role-card{background:#ecf7fa}h2{color:#225368}",
    chatTheme: { surface: "#0b2633ed", text: "#e4f5fa" },
    choices: [
      {
        id: "listen",
        title: "听听海风",
        text: "我停下来听着海风，等林岚继续说。",
        action: "fill",
      },
      {
        id: "letter",
        title: "追问信件",
        text: "我问林岚，信里还有什么线索？",
        action: "send",
      },
    ],
  },
  plain: {
    ...structuredClone(RoleViewDefinition.config),
    layout: "inline",
    title: "书店对话",
    media: { background: null, portrait: null, characterAvatar: "linlan.svg" },
    choices: [],
    showChoices: true,
    html: '<header><span>角色状态</span><strong data-bind="location"></strong></header><section class="clue"><label>时间</label><p data-bind="time"></p><label>线索</label><p data-bind="clue"></p></section>',
  },
};

RoleViewDefinition.variants.novel = {
  ...structuredClone(RoleViewDefinition.config),
  layout: "novel",
  title: "灯塔来信",
  novel: {
    autoMs: 2500,
    bgm: "harbor-theme.wav",
    gallery: ["bookshop.svg", "harbor.svg"],
  },
  shell: {
    html: '<main class="novel-frame"><slot name="scene"></slot><section class="story"><slot name="narrative"></slot></section><nav class="controls"><slot name="playback"></slot></nav><section class="tools"><slot name="choices"></slot><slot name="composer"></slot></section><aside class="history"><slot name="history"></slot></aside><aside class="status"><slot name="status"></slot></aside></main>',
    css: ".novel-frame{height:100%;position:relative;overflow:auto;background:#102129}slot{display:contents}.story{position:absolute;bottom:210px;left:3%;right:3%;height:190px}.controls{position:absolute;bottom:164px;left:3%;right:3%;height:46px}.tools{position:absolute;bottom:8px;left:3%;right:3%;height:148px;overflow:auto}.history,.status{position:absolute;inset:12px 4% 170px;pointer-events:none}.history ::slotted(*),.status ::slotted(*){pointer-events:auto}@media(max-width:700px){.novel-frame{min-height:860px}.story{height:220px;bottom:280px}.controls{bottom:190px;height:90px}.tools{height:175px}.history,.status{bottom:200px}}",
  },
};
