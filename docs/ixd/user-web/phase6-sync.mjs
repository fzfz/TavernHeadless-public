import { readFile, writeFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const tokens = JSON.parse(
  await readFile(new URL("phase6-tokens.json", root), "utf8"),
);
const specification = new URL("phase5-components.md", root);
const content = await readFile(specification, "utf8");
const documented = new Set();
const updated = content
  .split("\n")
  .map((line) => {
    const cells = line.split("|");
    const key = cells[1]?.trim().match(/^`(--[a-z-]+)`$/)?.[1];
    if (!key || !(key in tokens.colors || key in tokens.common)) return line;
    documented.add(key);
    const values = tokens.colors[key]
      ? [tokens.colors[key].light, tokens.colors[key].dark]
      : [tokens.common[key]];
    for (const [index, value] of values.entries()) {
      const cell = cells[index + 2];
      const current = cell
        .trim()
        .replace(/^引用 `(.+)`$/, "var($1)")
        .replace(/^`(.*)`$/, "$1");
      if (current === String(value)) continue;
      const display = /^var\((--[a-z-]+)\)$/.test(value)
        ? `引用 \`${value.slice(4, -1)}\``
        : /[(),"]/.test(value)
          ? `\`${value}\``
          : String(value);
      cells[index + 2] = ` ${display} `.padEnd(
        Math.max(cell.length, display.length + 2),
      );
    }
    return cells.join("|");
  })
  .join("\n");
const missing = [
  ...Object.keys(tokens.colors),
  ...Object.keys(tokens.common),
].filter((key) => !documented.has(key));
if (missing.length)
  throw new Error(
    `请在 phase5-components.md 增加变量用途行：${missing.join(", ")}`,
  );

function luminance(hex) {
  if (!/^#[0-9A-F]{6}$/i.test(hex))
    throw new Error(`对比度计算需要不透明 HEX 色值：${hex}`);
  const channels = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear.reduce(
    (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
    0,
  );
}
const pairs = [];
const surfaces = [
  "bg-page",
  "bg-surface",
  "bg-hover",
  "bg-pressed",
  "bg-selected",
];
function record(theme, foreground, background, minimum) {
  const fg = `--color-${foreground}`;
  const bg = `--color-${background}`;
  const [low, high] = [
    luminance(tokens.colors[fg][theme]),
    luminance(tokens.colors[bg][theme]),
  ].sort((a, b) => a - b);
  const ratio = (high + 0.05) / (low + 0.05);
  pairs.push({
    theme,
    foreground: fg,
    background: bg,
    ratio,
    minimum,
    pass: ratio >= minimum,
  });
}
for (const theme of ["light", "dark"]) {
  for (const fg of [
    "text-primary",
    "text-secondary",
    "text-placeholder",
    "primary",
    "success",
    "warning",
    "error",
    "info",
  ]) {
    for (const bg of surfaces) record(theme, fg, bg, 4.5);
  }
  for (const bg of [
    "primary",
    "primary-hover",
    "primary-pressed",
    "danger",
    "danger-hover",
    "danger-pressed",
  ]) {
    record(
      theme,
      bg.startsWith("danger") ? "on-danger" : "on-primary",
      bg,
      4.5,
    );
  }
  record(theme, "text-disabled", "bg-disabled", 4.5);
  for (const fg of ["border", "focus", "border-selected"]) {
    for (const bg of surfaces) record(theme, fg, bg, 3);
  }
}
const report = {
  source: "phase6-tokens.json",
  method:
    "WCAG relative luminance for opaque sRGB color pairs; ratios compared before rounding",
  textMinimum: Math.min(
    ...pairs.filter((pair) => pair.minimum === 4.5).map((pair) => pair.ratio),
  ),
  controlMinimum: Math.min(
    ...pairs.filter((pair) => pair.minimum === 3).map((pair) => pair.ratio),
  ),
  pairs,
};
await writeFile(specification, updated);
await writeFile(
  new URL("phase6-contrast.json", root),
  `${JSON.stringify(report, null, 2)}\n`,
);
const failures = pairs.filter((pair) => !pair.pass);
console.log(
  `已同步 ${documented.size} 个变量；对比度 ${pairs.length - failures.length}/${pairs.length} 通过。详细结果：docs/ixd/user-web/phase6-contrast.json`,
);
if (failures.length) {
  console.error(
    "请调整 phase6-tokens.json 中未达标的前景或背景色，然后重新运行本命令。",
  );
  process.exitCode = 1;
}
