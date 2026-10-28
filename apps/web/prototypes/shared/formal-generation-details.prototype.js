import {listInspectionRecords,loadInspectionSections} from "./generation-inspection.prototype.js";
export function generationDetailsUrl(sessionId, floorId) {
  const params = new URLSearchParams({source:"backend", session:sessionId});
  if (floorId) params.set("floor", floorId);
  return `/prototype/apps/web/prototypes/generation-details.prototype.html?${params}`;
}
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const json = (value) =>
  `<pre class="mono" style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(JSON.stringify(value, null, 2))}</pre>`;
const data = (value) => value?.data ?? value;
export async function listGenerationFloors(client, sessionId) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const body = await client.request(
      `/floors?session_id=${encodeURIComponent(sessionId)}&limit=100&offset=${offset}`,
      { raw: true },
    );
    rows.push(...data(body));
    if (!body.meta?.has_more) break;
  }
  return rows.sort(
    (a, b) => b.floor_no - a.floor_no || b.created_at - a.created_at,
  );
}
export async function loadGenerationDetail(client, floor) {
  const root = `/floors/${encodeURIComponent(floor.id)}`;
  const [run, pages] = await Promise.all([
    client.request(`${root}/run`),
    listInspectionRecords(client,`/pages?floor_id=${encodeURIComponent(floor.id)}`),
  ]);
  const result =
    floor.state === "committed" && data(run)?.run
      ? await client.request(`${root}/result`)
      : null;
  const pageDetails = await Promise.all(
    data(pages).sort((a,b)=>a.page_no-b.page_no).map(async (page) => ({
      ...page,
      messages: data(
        await listInspectionRecords(client,`/messages?page_id=${encodeURIComponent(page.id)}`),
      ),
    })),
  );
  return { floor, run: data(run), result: data(result), pages: pageDetails };
}
export function mountGenerationDetails({
  container,
  client,
  sessionId,
  errorText,
  onOpen,
  initialFloorId,
  onFloorChange,
  expanded = false,
  inspectionConfig,
}) {
  const root = container.ownerDocument.createElement("section");
  container.replaceChildren(root);
  root.innerHTML =
    '<h2>生成详情</h2><label class="field">会话轮次<select data-floor></select></label><button data-refresh>刷新记录</button><div data-detail></div><details><summary>按当前配置预览提示词</summary><form data-preview><label class="field">演绎者消息<textarea name="message" required rows="3"></textarea></label><button>预览提示词</button></form><div data-preview-result></div></details>';
  const select = root.querySelector("[data-floor]"),
    target = root.querySelector("[data-detail]");
  if (onOpen) {
    const open = container.ownerDocument.createElement("button");
    open.textContent = "打开生成详情";
    open.onclick = () => onOpen(select.value);
    root.querySelector("[data-refresh]").after(open);
  }
  let floors = [],
    sequence = 0;
  const report = (node, e) =>
    (node.innerHTML = `<p role="alert">${escape(errorText(e))}</p>`);
  const details = (label, value) =>
    value == null
      ? ""
      : `<details ${expanded ? "open" : ""}><summary>${label}</summary>${json(value)}</details>`;
  async function show() {
    const request = ++sequence,
      floor = floors.find((f) => f.id === select.value);
    if (!floor) {
      target.innerHTML = "<p>暂无生成记录。请在管理端打开当前会话，点击“继续演绎”开始对话。</p>";
      return;
    }
    onFloorChange?.(floor.id);
    target.innerHTML = '<p role="status">正在读取生成记录…</p>';
    try {
      const record = await loadGenerationDetail(client, floor);
      if (request !== sequence || !root.isConnected) return;
      const run = record.run?.run;
      target.innerHTML = `<dl><dt>分支</dt><dd>${escape(floor.branch_id)}</dd><dt>输入 Token</dt><dd>${escape(floor.token_in)}</dd><dt>输出 Token</dt><dd>${escape(floor.token_out)}</dd>${run ? `<dt>执行 ID</dt><dd style="overflow-wrap:anywhere">${escape(run.run_id)}</dd><dt>执行次数</dt><dd>${escape(run.attempt_no)}</dd><dt>耗时</dt><dd>${run.completed_at ? `${run.completed_at - run.started_at} ms` : "执行中"}</dd>` : ""}</dl>${details("执行状态与阶段", record.run)}${details("错误详情", run?.error)}${record.pages.map((p) => `<details ${p.page_kind === "input" ? "open" : ""}><summary>${p.page_kind === "input" ? "演绎者消息" : "生成消息"} · 第 ${p.page_no} 页</summary>${p.messages.map((m) => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(m.content)}</p>`).join("")}${details("页面记录", p)}</details>`).join("")}${details("轮次提交结果", record.result)}${details("轮次记录", floor)}<div data-inspections></div>`;
      if (inspectionConfig) {
        const host=target.querySelector('[data-inspections]');
        host.innerHTML='<p role="status">正在读取提示词、工具和状态记录…</p>';
        const sections=await loadInspectionSections(client,floor,record.pages,inspectionConfig);
        if(request!==sequence || !root.isConnected)return;
        host.innerHTML=sections.map(section=>{
          const content=section.error?`<p role="alert">${escape(errorText(section.error))}</p>`:
            section.key==='prompt'?Object.entries(inspectionConfig.promptFields).map(([key,label])=>details(label,section.value?.[key])).join(''):
            json(section.value);
          return `<details data-inspection="${escape(section.key)}"><summary>${escape(section.label)}</summary>${content}</details>`;
        }).join('');

      }
    } catch (e) {
      if (request === sequence && root.isConnected) report(target, e);
    }
  }
  async function refresh() {
    const selected = select.value || initialFloorId;
    target.innerHTML = '<p role="status">正在读取会话轮次…</p>';
    try {
      floors = await listGenerationFloors(client, sessionId);
      if (!root.isConnected) return;
      const statuses = {
        draft: "草稿",
        generating: "生成中",
        committed: "已提交",
        failed: "失败",
      };
      select.innerHTML = floors
        .map(
          (f) =>
            `<option value="${escape(f.id)}">${f.floor_no === 0 ? "开场" : `第 ${f.floor_no} 轮`} · ${escape(statuses[f.state] || f.state)} · ${escape(f.branch_id)}</option>`,
        )
        .join("");
      if (floors.some((f) => f.id === selected)) select.value = selected;
      await show();
    } catch (e) {
      if (root.isConnected) report(target, e);
    }
  }
  select.onchange = show;
  root.querySelector("[data-refresh]").onclick = refresh;
  root.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter,
      output = root.querySelector("[data-preview-result]");
    button.disabled = true;
    try {
      output.innerHTML = json(
        await client.dryRun(
          sessionId,
          new FormData(event.currentTarget).get("message"),
        ),
      );
    } catch (e) {
      report(output, e);
    } finally {
      button.disabled = false;
    }
  };
  return refresh();
}
