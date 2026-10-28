import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire, SourceMap } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const rerun = "node --test scripts/dependency-compatibility.node-test.mjs";

function scope(relativeManifest) {
  return {
    entry: join(root, relativeManifest),
    require: createRequire(join(root, relativeManifest)),
    manifest: { name: relativeManifest, version: "workspace" },
  };
}

function dependency(parent, name) {
  let entry;
  try {
    entry = realpathSync(parent.require.resolve(name));
  } catch (cause) {
    throw new Error(
      `Missing prerequisite: ${name} cannot be resolved from ${parent.manifest.name}@${parent.manifest.version} (${parent.entry}). Complete the approved workspace dependency installation, then run: ${rerun}`,
      { cause },
    );
  }
  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      );
      if (manifest.name === name) {
        return { entry, directory, manifest, require: createRequire(entry) };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert.notEqual(
      directory,
      parse(directory).root,
      `Cannot locate ${name}'s package.json`,
    );
  }
}

async function installedVersions(t, packages) {
  await t.test(
    "the requested parent and overridden child versions are installed",
    () => {
      for (const [pkg, expected] of packages) {
        t.diagnostic(
          `${pkg.manifest.name}@${pkg.manifest.version}: ${pkg.entry}`,
        );
        assert.equal(
          pkg.manifest.version,
          expected,
          `${pkg.manifest.name} must resolve to ${expected} at the tested parent boundary; complete the approved dependency installation and rerun: ${rerun}`,
        );
      }
    },
  );
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "dependency compatibility "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function assertRule(css, selector, declarations, media) {
  const matches = [];
  css.walkRules((rule) => {
    if (rule.selector !== selector) return;
    if (
      media &&
      (rule.parent.type !== "atrule" || rule.parent.params !== media)
    )
      return;
    matches.push(rule);
  });
  assert.equal(matches.length, 1, `Expected one CSS rule for ${selector}`);
  for (const [property, value] of Object.entries(declarations)) {
    const values = matches[0].nodes
      .filter((node) => node.type === "decl" && node.prop === property)
      .map((node) => node.value);
    assert.deepEqual(values, [value], `${selector}: ${property}`);
  }
}

test("vitepress consumes the overridden Vite Node exports", async (t) => {
  const vitepress = dependency(scope("vitepress/package.json"), "vitepress");
  const vite = dependency(vitepress, "vite");
  await installedVersions(t, [
    [vitepress, "1.6.4"],
    [vite, "6.4.5"],
  ]);

  await t.test(
    "VitePress can import its required exports and use config and TS helpers",
    async (t) => {
      const exportTarget = vite.manifest.exports["."].import;
      const modulePath =
        typeof exportTarget === "string" ? exportTarget : exportTarget.default;
      const api = await import(
        pathToFileURL(join(vite.directory, modulePath)).href
      );
      for (const name of [
        "normalizePath",
        "loadEnv",
        "loadConfigFromFile",
        "createLogger",
        "mergeConfig",
        "searchForWorkspaceRoot",
        "build",
        "transformWithEsbuild",
        "createServer",
      ])
        assert.equal(
          typeof api[name],
          "function",
          `Missing VitePress import: ${name}`,
        );

      assert.equal(
        api.normalizePath(join("docs", "guide", "..", "index.md")),
        "docs/index.md",
      );
      assert.deepEqual(
        api.mergeConfig(
          { define: { FIRST: "1" } },
          { define: { SECOND: "2" } },
        ),
        {
          define: { FIRST: "1", SECOND: "2" },
        },
      );
      const directory = await temporary(t);
      await writeFile(join(directory, ".env"), "VITE_COMPATIBILITY=base\n");
      await writeFile(
        join(directory, ".env.production"),
        "VITE_COMPATIBILITY=production\n",
      );
      assert.equal(
        api.loadEnv("production", directory).VITE_COMPATIBILITY,
        "production",
      );
      const transformed = await api.transformWithEsbuild(
        "export const answer: number = 42;",
        join(directory, "vite source.ts"),
        { loader: "ts" },
      );
      const output = join(directory, "vite output.mjs");
      await writeFile(output, transformed.code);
      assert.equal((await import(pathToFileURL(output).href)).answer, 42);
    },
  );
});

test("core-utils consumes the overridden esbuild for CJS and ESM transforms", async (t) => {
  const drizzle = dependency(scope("package.json"), "drizzle-kit");
  const loader = dependency(drizzle, "@esbuild-kit/esm-loader");
  const core = dependency(loader, "@esbuild-kit/core-utils");
  const esbuild = dependency(core, "esbuild");
  await installedVersions(t, [
    [core, "3.3.2"],
    [esbuild, "0.25.12"],
  ]);
  const api = core.require(core.entry);
  const source =
    "type Score = { answer: number };\nexport const result: Score = { answer: 42 };\n";

  for (const extension of ["ts", "cts", "mts"]) {
    for (const mode of ["sync CJS", "async ESM"]) {
      await t.test(
        `${mode} executes .${extension} and maps a filename containing spaces`,
        async (t) => {
          const directory = await temporary(t);
          const input = join(directory, `source with spaces.${extension}`);
          await writeFile(input, source);
          const sync = mode === "sync CJS";
          const result = sync
            ? api.transformSync(source, input)
            : await api.transform(source, input);
          const output = join(directory, sync ? "result.cjs" : "result.mjs");
          await writeFile(output, result.code);
          const evaluated = sync
            ? createRequire(import.meta.url)(output)
            : await import(pathToFileURL(output).href);
          assert.deepEqual(evaluated.result, { answer: 42 });
          assert.deepEqual(result.warnings, []);
          const map =
            typeof result.map === "string"
              ? JSON.parse(result.map)
              : result.map;
          assert.equal(map.version, 3);
          assert.deepEqual(map.sources, [input]);
          assert.deepEqual(map.sourcesContent, [await readFile(input, "utf8")]);
          const beforeValue = result.code.slice(0, result.code.indexOf("42"));
          const generatedLines = beforeValue.split("\n");
          const entry = new SourceMap(map).findEntry(
            generatedLines.length - 1,
            generatedLines.at(-1).length,
          );
          assert.equal(entry.originalSource, input);
          assert.equal(entry.originalLine, 1);
          assert.equal(
            entry.originalColumn,
            source.split("\n")[1].indexOf("42"),
          );
        },
      );
    }
  }

  await t.test(
    "both transform interfaces report the source filename and syntax location",
    async (t) => {
      const directory = await temporary(t);
      const input = join(directory, "invalid source.ts");
      const validate = (error) => {
        assert.match(error.message, /Transform failed/);
        assert.equal(error.errors.length, 1);
        assert.equal(error.errors[0].location.file, input);
        assert.equal(error.errors[0].location.line, 1);
        return true;
      };
      assert.throws(
        () => api.transformSync("export const broken: = ;", input),
        validate,
      );
      await assert.rejects(
        api.transform("export const broken: = ;", input),
        validate,
      );
    },
  );
});

test("tailwindcss consumes the overridden selector parser for utility variants and apply", async (t) => {
  const tailwind = dependency(scope("package.json"), "tailwindcss");
  const parser = dependency(tailwind, "postcss-selector-parser");
  await installedVersions(t, [
    [tailwind, "3.4.19"],
    [parser, "7.1.7"],
  ]);

  await t.test(
    "fixed utilities produce the expected selectors and declarations",
    async (t) => {
      const directory = await temporary(t);
      const postcss = tailwind.require("postcss");
      const plugin = tailwind.require(tailwind.entry);
      const css = await postcss([
        plugin({
          content: [
            {
              raw: "hover:bg-red-500 dark:bg-black group-hover:text-white peer-checked:block [&>*]:p-2 w-1/2",
              extension: "html",
            },
          ],
          darkMode: "class",
          corePlugins: { preflight: false },
          theme: {
            colors: { red: { 500: "#ef4444" }, black: "#000", white: "#fff" },
            spacing: { 2: "0.5rem" },
            width: { "1/2": "50%" },
          },
        }),
      ]).process(
        "@tailwind utilities;\n.apply-target { @apply hover:bg-red-500 w-1/2; }",
        {
          from: join(directory, "tailwind input.css"),
          to: join(directory, "tailwind output.css"),
        },
      );
      await writeFile(css.opts.to, css.css);
      assert.deepEqual(css.warnings(), []);
      assertRule(css.root, ".hover\\:bg-red-500:hover", {
        "background-color": "rgb(239 68 68 / var(--tw-bg-opacity, 1))",
      });
      assertRule(css.root, ".dark\\:bg-black:is(.dark *)", {
        "background-color": "rgb(0 0 0 / var(--tw-bg-opacity, 1))",
      });
      assertRule(css.root, ".group:hover .group-hover\\:text-white", {
        color: "rgb(255 255 255 / var(--tw-text-opacity, 1))",
      });
      assertRule(css.root, ".peer:checked ~ .peer-checked\\:block", {
        display: "block",
      });
      assertRule(css.root, ".\\[\\&\\>\\*\\]\\:p-2>*", { padding: "0.5rem" });
      assertRule(css.root, ".w-1\\/2", { width: "50%" });
      assertRule(css.root, ".apply-target", { width: "50%" });
      assertRule(css.root, ".apply-target:hover", {
        "background-color": "rgb(239 68 68 / var(--tw-bg-opacity, 1))",
      });
      assert.deepEqual(
        css.root.nodes
          .filter((node) => node.type === "rule")
          .map((rule) => rule.selector),
        [
          ".w-1\\/2",
          ".apply-target",
          ".apply-target:hover",
          ".hover\\:bg-red-500:hover",
          ".group:hover .group-hover\\:text-white",
          ".peer:checked ~ .peer-checked\\:block",
          ".dark\\:bg-black:is(.dark *)",
          ".\\[\\&\\>\\*\\]\\:p-2>*",
        ],
      );
      css.root.walkAtRules("apply", () =>
        assert.fail("@apply must be expanded"),
      );
    },
  );
});

test("postcss-nested consumes its overridden selector parser for nested selectors", async (t) => {
  const tailwind = dependency(scope("package.json"), "tailwindcss");
  const nested = dependency(tailwind, "postcss-nested");
  const parser = dependency(nested, "postcss-selector-parser");
  await installedVersions(t, [
    [nested, "6.2.0"],
    [parser, "7.1.7"],
  ]);

  await t.test(
    "selector lists, sibling nesting, is(), and media bubbling retain their meaning",
    async (t) => {
      const directory = await temporary(t);
      const postcss = nested.require("postcss");
      const css = await postcss([nested.require(nested.entry)]).process(
        `
.a, .b {
  &:hover { color: red; }
  & + & { margin-left: 1rem; }
  :is(&, .c) { color: blue; }
  @media (min-width: 40rem) { & > .child { display: block; } }
}`,
        {
          from: join(directory, "nested input.css"),
          to: join(directory, "nested output.css"),
        },
      );
      await writeFile(css.opts.to, css.css);
      assert.deepEqual(css.warnings(), []);
      assertRule(css.root, ".a:hover, .b:hover", { color: "red" });
      assertRule(css.root, ".a + .a, .b + .b", { "margin-left": "1rem" });
      assertRule(css.root, ":is(.a, .c), :is(.b, .c)", { color: "blue" });
      assertRule(
        css.root,
        ".a > .child, .b > .child",
        { display: "block" },
        "(min-width: 40rem)",
      );
      let count = 0;
      css.root.walkRules((rule) => {
        count += 1;
        assert.equal(rule.selector.includes("&"), false);
      });
      assert.equal(count, 4);
    },
  );
});

test("micromark-extension-math consumes the overridden KaTeX renderer", async (t) => {
  const cli = dependency(scope("package.json"), "markdownlint-cli2");
  const markdownlint = dependency(cli, "markdownlint");
  const math = dependency(markdownlint, "micromark-extension-math");
  const katex = dependency(math, "katex");
  const micromark = dependency(markdownlint, "micromark");
  await installedVersions(t, [
    [math, "3.1.0"],
    [katex, "0.18.10"],
  ]);
  const { math: syntax, mathHtml } = await import(
    pathToFileURL(math.entry).href
  );
  const {
    micromark: render,
    parse: parseMarkdown,
    postprocess,
    preprocess,
  } = await import(pathToFileURL(micromark.entry).href);

  await t.test("math syntax emits inline and block math tokens", () => {
    const markdown = "Inline $x^2$.\n\n$$\n\\frac{1}{2}\n$$\n";
    const events = postprocess(
      parseMarkdown({ extensions: [syntax()] })
        .document()
        .write(preprocess()(markdown, "utf8", true)),
    );
    const tokens = events
      .filter(([action]) => action === "enter")
      .map(([, token, context]) => [token.type, context.sliceSerialize(token)]);
    assert.ok(
      tokens.some(([type, value]) => type === "mathText" && value === "$x^2$"),
    );
    assert.ok(
      tokens.some(
        ([type, value]) => type === "mathFlowValue" && value === "\\frac{1}{2}",
      ),
    );
  });

  await t.test(
    "mathHtml renders inline and display MathML with their formulas",
    async (t) => {
      const directory = await temporary(t);
      const options = {
        extensions: [syntax()],
        htmlExtensions: [mathHtml({ throwOnError: true })],
      };
      const inline = render("Inline $x^2$.", options);
      const block = render("$$\n\\frac{1}{2}\n$$", options);
      await writeFile(join(directory, "inline.html"), inline);
      await writeFile(join(directory, "block.html"), block);
      assert.match(inline, /class="katex"/);
      assert.match(inline, /<msup>/);
      assert.match(
        inline,
        /<annotation encoding="application\/x-tex">x\^2<\/annotation>/,
      );
      assert.doesNotMatch(inline, /katex-display/);
      assert.match(block, /class="katex-display"/);
      assert.match(block, /display="block"/);
      assert.match(block, /<mfrac>/);
      assert.match(
        block,
        /<annotation encoding="application\/x-tex">\\frac\{1\}\{2\}<\/annotation>/,
      );
    },
  );

  await t.test(
    "mathHtml exposes invalid formulas when throwOnError is enabled",
    () => {
      assert.throws(
        () =>
          render("$\\invalidcompatibilitycommand$", {
            extensions: [syntax()],
            htmlExtensions: [mathHtml({ throwOnError: true })],
          }),
        /Undefined control sequence/,
      );
    },
  );
});
