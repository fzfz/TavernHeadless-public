// The catalog selects backend resources. Layout selection belongs to the stored snapshot.
let backendCharacters = [];
let characterLoadSequence = 0;
async function selectBackendCharacter(id) {
  const sequence = ++characterLoadSequence;
  const response = await fetch(`/characters/${encodeURIComponent(id)}`).catch(
    () => {
      throw Error("角色读取失败，请重新选择角色。");
    },
  );
  if (!response.ok) throw Error("角色读取失败，请重新选择角色。");
  const { data } = await response.json();
  if (sequence !== characterLoadSequence) return;
  const version = data.latest_version;
  if (!version)
    throw Error("该角色尚未保存版本，请在管理端保存角色后重新选择。");
  const snapshot = version.snapshot;
  const cardPackage = snapshot.extensions?.tavern_headless?.card_view;
  const packageIssue = CardContract.validate(cardPackage, cardSchema);
  if (packageIssue) throw Error(CardContract.explain(packageIssue));
  // Adapt identity to the pre-existing chat prototype; card rendering reads cardPackage only.
  const presentation = clone(RoleViewDefinition.config);
  presentation.title = cardPackage.title;
  presentation.characterName = snapshot.name;
  presentation.media.characterAvatar =
    cardPackage.assets[cardPackage.avatar].file;
  const key = `character:${data.id}:${version.id}`;
  let session = sessions.find((s) => s.id === key);
  if (!session) {
    let resource = getResource(data.id);
    if (!resource) {
      resource = {
        id: data.id,
        kind: "character",
        name: data.name,
        versions: [],
      };
      resources.push(resource);
    }
    resource.versions[version.version_no - 1] = clone(snapshot);
    const config = clone(saved);
    config.character = { id: data.id, version: version.version_no };
    config.presentation = clone(presentation);
    session = sessionState({
      id: key,
      name: `${snapshot.name} · ${presentation.title}`,
      revision: version.version_no,
      config,
      status: "active",
      purpose: "preview",
      messages: [{ text: snapshot.first_mes || "", opening: true }],
      input: "",
      running: false,
      rounds: [],
      debugFloor: null,
      performer: clone(RoleViewDefinition.performer),
      viewDetails: true,
      cardPackage: cardPackage ? clone(cardPackage) : null,
      cardUi: cardPackage ? clone(cardPackage.ui) : null,
      cardRecords: cardPackage
        ? [{ snapshotId: "initial", variables: clone(cardPackage.initial) }]
        : null,
      backendCharacter: data.id,
      backendVersion: version.id,
    });
    sessions.push(session);
  }
  clearTimeout(novelTimer);
  novelAudio?.pause();
  novelAudio = null;
  novelAudioSession = null;
  if (getSession()?.reading) getSession().reading.auto = false;
  selected = session.id;
  userHome = false;
  render();
}
const renderBeforeCharacterCatalog = render;
render = () => {
  renderBeforeCharacterCatalog();
  if (!backendCharacters.length || prototypeSurface !== "user") return;
  const label = document.createElement("label");
  label.className = "character-picker";
  label.innerHTML = `角色 <select aria-label="选择角色">${backendCharacters.map((c) => `<option value="${esc(c.id)}" ${getSession()?.backendCharacter === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
  label.querySelector("select").onchange = (e) =>
    selectBackendCharacter(e.target.value).catch((error) =>
      notify(error.message),
    );
  document.querySelector(".topbar .row").prepend(label);
};
if (prototypeQuery.get("source") === "backend") {
  (async () => {
    globalThis.CardErrors = await (
      await fetch("../../web/prototypes/shared/card-errors.json")
    ).json();
    cardSchema = await (
      await fetch("../../web/prototypes/shared/card-contract.schema.json")
    ).json();
    const response = await fetch("/characters").catch(() => {
      throw Error("角色列表读取失败，请刷新页面。");
    });
    if (!response.ok) throw Error("角色列表读取失败，请刷新页面。");
    const { data } = await response.json();
    backendCharacters = data;
    render();
    if (!backendCharacters.length)
      throw Error("暂无角色，请在管理端创建角色。");
    await selectBackendCharacter(backendCharacters[0].id);
  })().catch((error) => notify(error.message));
}
