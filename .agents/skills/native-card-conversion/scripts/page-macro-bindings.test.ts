import { fork } from "node:child_process";
import { once } from "node:events";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  withTestResources,
  testResources,
  testRuntime,
} from "./test-resources.ts";
import { v2Card } from "./source-fixtures.ts";
import { listFiles, indexPackage } from "./index.ts";
import { begin } from "./source.ts";
import { bindPageMacros } from "./page-macro-bindings.ts";
import { validate } from "./tool.ts";

const entrypoint = resolve(
  ".agents/skills/native-card-conversion/scripts/convert.mjs",
);

async function cli(...args: string[]) {
  const result = await testResources().execute(process.execPath, [
    entrypoint,
    ...args,
  ]);
  expect(result.stderr).toBe("");
  const ref = JSON.parse(result.stdout);
  expect(ref.resultFile).toBeTypeOf("string");
  expect(Buffer.byteLength(result.stdout)).toBeLessThan(1200);
  const saved = JSON.parse(await readFile(ref.resultFile, "utf8"));
  expect(saved.passed).toBe(true);
  if (args[0] === "bind-page-macros" && !args.includes("--help"))
    testResources().addDirectory(dirname(saved.data.taskFile));
  return saved.data;
}

async function rejected(
  _command: "bind-page-macros",
  taskFile: string,
  requestFile: string,
) {
  let result;
  try {
    result = await bindPageMacros(taskFile, requestFile);
  } catch (error) {
    return { error: String(error) };
  }
  expect(result.passed).toBe(false);
  return result;
}

async function fixture(
  html: string,
  template: string,
  script = "export function mount({ api }) { const original = api.ui.register('original', {elements:{heading:{selector:'#heading',kind:'text'}}}); original.update({heading:{text:'原页面'}}); return; }",
  cardData: Record<string, unknown> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "page-macro-bindings-"));
  testResources().addDirectory(root);
  const sourceFile = join(root, "source.json");
  await writeFile(
    sourceFile,
    JSON.stringify(
      v2Card({ name: "陆泽", ...cardData, extensions: { page: html } }),
    ),
  );
  const begun = await begin(sourceFile);
  testResources().addDirectory(dirname(begun.taskFile));
  const task = JSON.parse(await readFile(begun.taskFile, "utf8"));
  await mkdir(join(task.packageDirectory, "frontend"), { recursive: true });
  const frontend = {
    apiVersion: 1,
    html: "frontend/index.html",
    css: "frontend/style.css",
    script: "frontend/main.js",
    assets: {},
    data: {},
  };
  await writeFile(
    join(task.packageDirectory, "frontend/manifest.json"),
    JSON.stringify(frontend),
  );
  await writeFile(join(task.packageDirectory, "frontend/index.html"), html);
  await writeFile(
    join(task.packageDirectory, "frontend/style.css"),
    "p { color: red; }",
  );
  await writeFile(join(task.packageDirectory, "frontend/main.js"), script);
  const start = html.indexOf(template);
  const request = {
    id: "husband",
    source: {
      pointer: "/data/extensions/page",
      start,
      end: start + template.length,
    },
    htmlFile: frontend.html,
    template,
  };
  const requestFile = join(root, "request.json");
  await writeFile(requestFile, JSON.stringify(request));
  return { root, task, begun, request, requestFile, html, frontend };
}

it(
  "绑定命令返回独立有效任务并保留父包、源快照和二进制资源",
  withTestResources(async () => {
    const template = "姓名：{{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
    );
    const binary = Buffer.from([0, 255, 128, 13, 10]);
    await mkdir(join(f.task.packageDirectory, "assets"), { recursive: true });
    await writeFile(join(f.task.packageDirectory, "assets/sample.png"), binary);
    await writeFile(
      join(f.task.outputDirectory, "preview-evidence.json"),
      "{}",
    );
    const before = await packageSnapshot(f.task.packageDirectory);
    const parentTask = await readFile(f.begun.taskFile);
    const parentSource = await readFile(f.task.sourceFile);
    const result = await cli(
      "bind-page-macros",
      f.begun.taskFile,
      f.requestFile,
    );
    expect(result.taskFile).not.toBe(f.begun.taskFile);
    expect(result.packageDirectory).not.toBe(f.task.packageDirectory);
    const task = JSON.parse(await readFile(result.taskFile, "utf8"));
    expect(task).toMatchObject({
      id: basename(task.outputDirectory),
      sourceFile: join(task.outputDirectory, "source.json"),
      originalSourceFile: f.task.originalSourceFile,
      repositoryRoot: f.task.repositoryRoot,
      packageDirectory: join(task.outputDirectory, "package"),
    });
    expect(result.taskFile).toBe(join(task.outputDirectory, "task.json"));
    expect(dirname(task.outputDirectory)).toBe(dirname(f.task.outputDirectory));
    expect(await readFile(task.sourceFile)).toEqual(parentSource);
    expect(await readFile(f.begun.taskFile)).toEqual(parentTask);
    expect(await packageSnapshot(f.task.packageDirectory)).toEqual(before);
    expect(
      await readFile(join(result.packageDirectory, "assets/sample.png")),
    ).toEqual(binary);
    expect((await readdir(task.outputDirectory)).sort()).toEqual([
      "package",
      "source.json",
      "task.json",
    ]);
    await cli("index", result.taskFile, "--frontend", "frontend/manifest.json");
    await cli("validate", result.taskFile);
    const packed = await cli("pack", result.taskFile);
    expect(packed.taskFile).toBe(result.taskFile);
  }),
  testRuntime.integrationTimeoutMs,
);

async function bind(taskFile: string, requestFile: string) {
  const result = await bindPageMacros(taskFile, requestFile);
  expect(result.passed).toBe(true);
  if (!result.passed) throw new Error(JSON.stringify(result.issues));
  testResources().addDirectory(dirname(result.taskFile));
  return result;
}

async function packageSnapshot(directory: string) {
  const files = await listFiles(directory);
  return files.map(({ path, content }) => ({ path, content: [...content] }));
}

it(
  "沿返回任务连续绑定时保留两个绑定和此前完整产物",
  withTestResources(async () => {
    const firstTemplate = "甲：{{user}}";
    const secondTemplate = "乙：{{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${firstTemplate}</p><p>${secondTemplate}</p>`,
      firstTemplate,
    );
    const first = await bind(f.begun.taskFile, f.requestFile);
    const before = await packageSnapshot(first.packageDirectory);
    const secondRequest = await additionalRequest(
      f,
      "companion",
      secondTemplate,
    );
    const second = await bind(first.taskFile, secondRequest);
    expect(second.taskFile).not.toBe(first.taskFile);
    const html = await readFile(
      join(second.packageDirectory, "frontend/index.html"),
      "utf8",
    );
    expect(html).toContain('data-page-macro="husband"');
    expect(html).toContain('data-page-macro="companion"');
    const installation = JSON.parse(
      await readFile(
        join(second.packageDirectory, "data/page-macro-installation.json"),
        "utf8",
      ),
    );
    expect(installation.sources.map((item: { id: string }) => item.id)).toEqual(
      ["husband", "companion"],
    );
    expect(await packageSnapshot(first.packageDirectory)).toEqual(before);
    await expect(
      indexPackage(second.taskFile, "frontend/manifest.json"),
    ).resolves.toMatchObject({ passed: true });
    await expect(validate(second.taskFile)).resolves.toMatchObject({
      passed: true,
    });
  }),
);

async function additionalRequest(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  template: string,
) {
  const start = f.html.indexOf(template);
  const requestFile = join(f.root, id + ".json");
  await writeFile(
    requestFile,
    JSON.stringify({
      ...f.request,
      id,
      template,
      source: { ...f.request.source, start, end: start + template.length },
    }),
  );
  return requestFile;
}

it(
  "同父任务并发绑定返回两个独立完整包并保持父包",
  withTestResources(async () => {
    const firstTemplate = "甲：{{user}}";
    const secondTemplate = "乙：{{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${firstTemplate}</p><p>${secondTemplate}</p>`,
      firstTemplate,
    );
    const secondRequest = await additionalRequest(
      f,
      "companion",
      secondTemplate,
    );
    const before = await packageSnapshot(f.task.packageDirectory);
    const completed = await Promise.allSettled([
      cli("bind-page-macros", f.begun.taskFile, f.requestFile),
      cli("bind-page-macros", f.begun.taskFile, secondRequest),
    ]);
    const [first, second] = completed.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(first.taskFile).not.toBe(second.taskFile);
    expect(first.packageDirectory).not.toBe(second.packageDirectory);
    const firstHtml = await readFile(
      join(first.packageDirectory, "frontend/index.html"),
      "utf8",
    );
    const secondHtml = await readFile(
      join(second.packageDirectory, "frontend/index.html"),
      "utf8",
    );
    expect(firstHtml).toContain('data-page-macro="husband"');
    expect(firstHtml).toContain(secondTemplate);
    expect(secondHtml).toContain('data-page-macro="companion"');
    expect(secondHtml).toContain(firstTemplate);
    expect(await packageSnapshot(f.task.packageDirectory)).toEqual(before);
    for (const result of [first, second]) {
      await cli(
        "index",
        result.taskFile,
        "--frontend",
        "frontend/manifest.json",
      );
      await cli("validate", result.taskFile);
      await cli("pack", result.taskFile);
    }
  }),
  testRuntime.integrationTimeoutMs,
);

it(
  "一个并发绑定写入失败时删除其子任务并保留诊断、父包和成功包",
  withTestResources(async () => {
    const firstTemplate = "甲：{{user}}";
    const secondTemplate = "乙：{{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${firstTemplate}</p><p>${secondTemplate}</p>`,
      firstTemplate,
    );
    const secondRequest = await additionalRequest(
      f,
      "companion",
      secondTemplate,
    );
    const parentBefore = await packageSnapshot(f.task.packageDirectory);
    const workerFile = join(f.root, "failed-binding.mjs");
    await writeFile(
      workerFile,
      `
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname } from "node:path";
const rename = fs.rename;
fs.rename = async (from, to) => {
  if (String(to).endsWith("/frontend/page-macro-entry.js")) {
    process.send({ directory: dirname(dirname(dirname(String(to)))) });
    await new Promise(resolve => process.once("message", resolve));
    throw Object.assign(new Error("EIO: 绑定写入失败测试"), { code: "EIO" });
  }
  return rename(from, to);
};
syncBuiltinESMExports();
const { runCli } = await import(${JSON.stringify(resolve(".agents/skills/native-card-conversion/scripts/cli.ts"))});
await runCli(["bind-page-macros", ...process.argv.slice(2)]);
process.disconnect();
`,
    );
    const worker = fork(workerFile, [f.begun.taskFile, f.requestFile], {
      execArgv: ["--import", "tsx"],
      silent: true,
    });
    testResources().trackChild(worker);
    let stdout = "",
      stderr = "";
    worker.stdout!.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    worker.stderr!.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = once(worker, "exit");
    try {
      const [paused] = (await once(worker, "message")) as [
        { directory: string },
      ];
      testResources().addDirectory(paused.directory);
      const success = await cli(
        "bind-page-macros",
        f.begun.taskFile,
        secondRequest,
      );
      const successBefore = await packageSnapshot(success.packageDirectory);
      worker.send("continue");
      const [code] = await exited;
      expect(code).toBe(1);
      expect(stdout).toBe("");
      const diagnostic = JSON.parse(stderr);
      const saved = JSON.parse(
        await readFile(diagnostic.diagnosticFile, "utf8"),
      );
      expect(saved.passed).toBe(false);
      expect(saved.data.error).toContain("EIO");
      await expect(lstat(paused.directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await packageSnapshot(f.task.packageDirectory)).toEqual(
        parentBefore,
      );
      expect(await packageSnapshot(success.packageDirectory)).toEqual(
        successBefore,
      );
      await cli(
        "index",
        success.taskFile,
        "--frontend",
        "frontend/manifest.json",
      );
      await cli("validate", success.taskFile);
      await cli("pack", success.taskFile);
    } finally {
      worker.kill();
    }
  }),
  testRuntime.integrationTimeoutMs,
);

it(
  "绑定命令保留页面结构、原入口挂载和重复姓名模板，并生成通过正式前端校验的包",
  withTestResources(async () => {
    const template = "身份: {{user}}的丈夫，{{user}}的同伴";
    const f = await fixture(
      `<h1 id="heading"></h1><p class="profile">前文 <b>陆泽</b> ${template} &amp; 后文</p>`,
      template,
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const html = await readFile(
      join(result.packageDirectory, "frontend/index.html"),
      "utf8",
    );
    expect(html).toBe(
      '<h1 id="heading"></h1><p class="profile">前文 <b>陆泽</b> <span data-page-macro="husband"></span> &amp; 后文</p>',
    );
    expect(result.files).toContain("frontend/page-macros.js");
    const bindings = await readFile(
      join(result.packageDirectory, "frontend/page-macro-bindings.js"),
      "utf8",
    );
    expect(bindings).toContain(template);
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain("原页面");
    expect(entry).toContain("performerName");
    await expect(
      indexPackage(result.taskFile, "frontend/manifest.json"),
    ).resolves.toMatchObject({ passed: true });
    await expect(validate(result.taskFile)).resolves.toMatchObject({
      passed: true,
    });
  }),
);

it(
  "绑定命令帮助从宏注册配置提供完整支持表和请求结构",
  withTestResources(async () => {
    const help = await cli("bind-page-macros", "--help");
    expect(help.inputSchema.required).toEqual([
      "id",
      "source",
      "htmlFile",
      "template",
    ]);
    expect(help.pageMacroSupport.macros).toHaveLength(98);
    expect(
      help.pageMacroSupport.macros.find(
        (macro: { name: string }) => macro.name === "user",
      ).handler,
    ).toBe("user");
  }),
  testRuntime.integrationTimeoutMs,
);

it(
  "绑定命令从源卡提取固定资料，并登记资料递归引用的姓名依赖",
  withTestResources(async () => {
    const template = "简介：{{charDescription}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
      undefined,
      { description: "{{user}}是陆泽的同伴", character_version: "  1.0  " },
    );
    await writeFile(
      f.requestFile,
      JSON.stringify({ ...f.request, conditions: { card: "package-card" } }),
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const card = JSON.parse(
      await readFile(
        join(result.packageDirectory, "data/page-macro-card.json"),
        "utf8",
      ),
    );
    expect(card.description).toBe("{{user}}是陆泽的同伴");
    expect(card.character_version).toBe("  1.0  ");
    const manifest = JSON.parse(
      await readFile(
        join(result.packageDirectory, "frontend/manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.data.pageMacroCard).toBe("data/page-macro-card.json");
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain("performerName");
    expect(entry).toContain("pageMacroCard");
    expect(entry).not.toContain(".variables.");
  }),
);

it(
  "绑定命令按schema核对变量路径，并只为状态宏生成当前快照订阅",
  withTestResources(async () => {
    const template = "地点：{{getvar::place}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
    );
    await mkdir(join(f.task.packageDirectory, "state"), { recursive: true });
    await writeFile(
      join(f.task.packageDirectory, "state/schema.json"),
      JSON.stringify({
        type: "object",
        properties: { location: { type: "string" } },
        additionalProperties: false,
      }),
    );
    const request = {
      ...f.request,
      conditions: { variables: { place: ["missing"] } },
      stateSchemaFile: "state/schema.json",
    };
    await writeFile(f.requestFile, JSON.stringify(request));
    const failure = await rejected(
      "bind-page-macros",
      f.begun.taskFile,
      f.requestFile,
    );
    expect(JSON.stringify(failure)).toContain("missing");
    expect(
      await readFile(
        join(f.task.packageDirectory, "frontend/index.html"),
        "utf8",
      ),
    ).toBe(f.html);
    await writeFile(
      f.requestFile,
      JSON.stringify({
        ...request,
        conditions: { variables: { place: ["location"] } },
      }),
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain(".variables.get(");
    expect(entry).toContain(".variables.watch(");
    expect(entry).not.toContain("performerName");
    expect(entry).not.toContain(".messages.");
  }),
);

it(
  "绑定命令为保存消息宏生成分页读取、分支快照订阅和提交订阅",
  withTestResources(async () => {
    const template = "最近消息：{{lastMessage}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
    );
    await writeFile(
      f.requestFile,
      JSON.stringify({
        ...f.request,
        conditions: { messages: "saved-visible-active" },
      }),
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain(".messages.listFloors(");
    expect(entry).toContain(".messages.getFloor(");
    expect(entry).toContain("nextCursor");
    expect(entry).toContain(".variables.watch(");
    expect(entry).toContain(".variables.onTurnCommitted(");
    expect(entry).not.toContain("performerName");
    await expect(
      indexPackage(result.taskFile, "frontend/manifest.json"),
    ).resolves.toMatchObject({ passed: true });
    await expect(validate(result.taskFile)).resolves.toMatchObject({
      passed: true,
    });
  }),
);

it(
  "相同绑定以不同JSON字段顺序重试时保留唯一模块、入口和挂载位置",
  withTestResources(async () => {
    const template = "姓名：{{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
    );
    const first = await bind(f.begun.taskFile, f.requestFile);
    const before = await Promise.all(
      first.files.map((file: string) =>
        readFile(join(first.packageDirectory, file), "utf8"),
      ),
    );
    await writeFile(
      f.requestFile,
      JSON.stringify({
        ...f.request,
        source: {
          end: f.request.source.end,
          pointer: f.request.source.pointer,
          start: f.request.source.start,
        },
      }),
    );
    const second = await bind(first.taskFile, f.requestFile);
    expect(second.files).toEqual(first.files);
    const after = await Promise.all(
      second.files.map((file: string) =>
        readFile(join(second.packageDirectory, file), "utf8"),
      ),
    );
    expect(after).toEqual(before);
    const html = await readFile(
      join(second.packageDirectory, "frontend/index.html"),
      "utf8",
    );
    expect(html.match(/data-page-macro="husband"/g)).toHaveLength(1);
    const installation = JSON.parse(
      await readFile(
        join(second.packageDirectory, "data/page-macro-installation.json"),
        "utf8",
      ),
    );
    expect(installation.sources.map((item: { id: string }) => item.id)).toEqual(
      ["husband"],
    );
    await expect(
      indexPackage(second.taskFile, "frontend/manifest.json"),
    ).resolves.toMatchObject({ passed: true });
    await expect(validate(second.taskFile)).resolves.toMatchObject({
      passed: true,
    });
  }),
);

it(
  "固定开场资料保留alternate_greetings，并分析所选开场的递归姓名依赖",
  withTestResources(async () => {
    const template = "开场：{{charFirstMessage::1}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
      undefined,
      { first_mes: "第一条", alternate_greetings: ["{{user}}走进大厅。"] },
    );
    await writeFile(
      f.requestFile,
      JSON.stringify({ ...f.request, conditions: { card: "package-card" } }),
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const card = JSON.parse(
      await readFile(
        join(result.packageDirectory, "data/page-macro-card.json"),
        "utf8",
      ),
    );
    expect(card.alternate_greetings).toEqual(["{{user}}走进大厅。"]);
    expect(
      await readFile(
        join(result.packageDirectory, "frontend/page-macro-entry.js"),
        "utf8",
      ),
    ).toContain("performerName");
  }),
);

it(
  "模板边界切开HTML实体时命令拒绝绑定并保留完整页面",
  withTestResources(async () => {
    const template = "amp; {{user}}";
    const f = await fixture(
      `<h1 id="heading"></h1><p>&${template}</p>`,
      template,
    );
    const failure = await rejected(
      "bind-page-macros",
      f.begun.taskFile,
      f.requestFile,
    );
    expect(JSON.stringify(failure)).toContain("实体");
    expect(
      await readFile(
        join(f.task.packageDirectory, "frontend/index.html"),
        "utf8",
      ),
    ).toBe(f.html);
  }),
);

it.each([
  {
    html: '<h1 id="heading"></h1><p title="{{user}}">介绍</p>',
    reason: "HTML 文字节点",
  },
  {
    html: '<h1 id="heading"></h1><script>{{user}}</script>',
    reason: "HTML 文字节点",
  },
  {
    html: '<h1 id="heading"></h1><style>{{user}}</style>',
    reason: "HTML 文字节点",
  },
  {
    html: '<h1 id="heading"></h1><p>{{user}}</p><p>{{user}}</p>',
    reason: "匹配 2 次",
  },
])(
  "目标位置拒绝属性、脚本、样式和多次匹配：$reason",
  withTestResources(async ({ html, reason }) => {
    const f = await fixture(html, "{{user}}");
    const failure = await rejected(
      "bind-page-macros",
      f.begun.taskFile,
      f.requestFile,
    );
    expect(JSON.stringify(failure)).toContain(reason);
    expect(
      await readFile(
        join(f.task.packageDirectory, "frontend/index.html"),
        "utf8",
      ),
    ).toBe(html);
    expect(
      JSON.parse(
        await readFile(
          join(f.task.packageDirectory, "frontend/manifest.json"),
          "utf8",
        ),
      ),
    ).toEqual(f.frontend);
  }),
);

it(
  "零次匹配和宿主能力缺口均保留此前完整绑定文件",
  withTestResources(async () => {
    const template = "{{user}}";
    const html = '<h1 id="heading"></h1><p>{{user}}</p><p>{{summary}}</p>';
    const f = await fixture(html, template);
    const result = await bind(f.begun.taskFile, f.requestFile);
    const before = await Promise.all(
      result.files.map((file: string) =>
        readFile(join(result.packageDirectory, file), "utf8"),
      ),
    );
    const sourceStart = html.indexOf("{{summary}}");
    await writeFile(
      f.requestFile,
      JSON.stringify({
        ...f.request,
        id: "summaryText",
        template: "{{summary}}",
        source: {
          pointer: f.request.source.pointer,
          start: sourceStart,
          end: sourceStart + "{{summary}}".length,
        },
      }),
    );
    const unsupported = await rejected(
      "bind-page-macros",
      result.taskFile,
      f.requestFile,
    );
    expect(unsupported.issues[0]).toMatchObject({
      code: "HOST_CAPABILITY_REQUIRED",
      macro: "summary",
      source: { pointer: "/data/extensions/page", start: sourceStart },
    });
    expect(
      await Promise.all(
        result.files.map((file: string) =>
          readFile(join(result.packageDirectory, file), "utf8"),
        ),
      ),
    ).toEqual(before);
    await writeFile(
      f.requestFile,
      JSON.stringify({
        ...f.request,
        id: "missingText",
        location: { before: "不存在的前文", after: "" },
      }),
    );
    const missing = await rejected(
      "bind-page-macros",
      result.taskFile,
      f.requestFile,
    );
    expect(JSON.stringify(missing)).toContain("匹配 0 次");
    expect(
      await Promise.all(
        result.files.map((file: string) =>
          readFile(join(result.packageDirectory, file), "utf8"),
        ),
      ),
    ).toEqual(before);
  }),
);

it(
  "原入口已经登记默认布局ID时，生成器分配不同布局ID",
  withTestResources(async () => {
    const template = "{{user}}";
    const script =
      "export function mount({ api }) { api.ui.register('pageMacros', {elements:{heading:{selector:'#heading',kind:'text'}}}); }";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
      script,
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain('api.ui.register("pageMacros1"');
  }),
);

it(
  "异步入口的api别名与已有局部变量保留挂载行为并通过前端校验",
  withTestResources(async () => {
    const template = "{{user}}";
    const script =
      "export async function mount({ api: runtimeApi }) { await Promise.resolve(); const mountPageMacroText = 1; const macroLayout = runtimeApi.ui.register('original', {elements:{heading:{selector:'#heading',kind:'text'}}}); macroLayout.update({heading:{text:String(mountPageMacroText)}}); return; }";
    const f = await fixture(
      `<h1 id="heading"></h1><p>${template}</p>`,
      template,
      script,
    );
    const result = await bind(f.begun.taskFile, f.requestFile);
    expect(
      await readFile(join(f.task.packageDirectory, "frontend/main.js"), "utf8"),
    ).toBe(script);
    const entry = await readFile(
      join(result.packageDirectory, "frontend/page-macro-entry.js"),
      "utf8",
    );
    expect(entry).toContain("await Promise.resolve()");
    expect(entry).toContain("runtimeApi.data.get(");
    await expect(
      indexPackage(result.taskFile, "frontend/manifest.json"),
    ).resolves.toMatchObject({ passed: true });
    await expect(validate(result.taskFile)).resolves.toMatchObject({
      passed: true,
    });
  }),
);
