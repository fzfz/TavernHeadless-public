#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EnvironmentError } from "./errors.mjs";

const definitions = JSON.parse(
  await readFile(new URL("./commands.json", import.meta.url), "utf8"),
);

function commandOptions(spec) {
  return {
    ...definitions.common,
    ...spec.options,
    env: {
      ...definitions.common.env,
      choices: spec.environments ?? definitions.common.env.choices,
    },
  };
}

export function help(command) {
  if (!command)
    return (
      "用法：node scripts/environments/cli.mjs <command> --env <dev|staging|prod>\n" +
      Object.entries(definitions.commands)
        .map(([name, spec]) => `${name.padEnd(12)}${spec.description}`)
        .join("\n") +
      "\n使用 node scripts/environments/cli.mjs <command> --help 查看参数。\n"
    );
  const spec = definitions.commands[command];
  if (!spec)
    throw new EnvironmentError(
      `命令 ${command} 无效。可用值：${Object.keys(definitions.commands).join("、")}。`,
    );
  const options = commandOptions(spec);
  return (
    `${command}：${spec.description}\n` +
    Object.entries(options)
      .map(
        ([name, option]) =>
          `--${name} (${option.type}；${option.required ? "必填" : "可选"}${option.default !== undefined ? `；默认 ${option.default}` : ""}) ${option.description}${option.choices ? `；可用值 ${option.choices.join("|")}` : ""}`,
      )
      .join("\n") +
    `\n示例：node scripts/environments/cli.mjs ${command} --env ${options.env.choices[0]}${Object.entries(
      spec.options,
    )
      .filter(([, option]) => option.required)
      .map(([key]) => ` --${key} <${key}>`)
      .join("")}\n`
  );
}

export async function parseCommand(argv, stdin = process.stdin) {
  const [command, ...tokens] = argv;
  if (!command || command === "--help" || tokens.includes("--help"))
    return { help: help(command === "--help" ? undefined : command) };
  const spec = definitions.commands[command];
  if (!spec)
    throw new EnvironmentError(
      `命令 ${command} 无效。请执行 node scripts/environments/cli.mjs --help。`,
    );
  const options = commandOptions(spec);
  const supplied = {};
  for (let index = 0; index < tokens.length; index++) {
    const name = tokens[index].startsWith("--") ? tokens[index].slice(2) : "";
    const option = options[name];
    if (!option || name in supplied)
      throw new EnvironmentError(
        `参数 ${tokens[index]} 无效或重复。请执行 node scripts/environments/cli.mjs ${command} --help。`,
      );
    if (option.type === "boolean") supplied[name] = true;
    else {
      const value = tokens[++index];
      if (value === undefined || value.startsWith("--"))
        throw new EnvironmentError(
          `--${name} 缺少值。请执行 node scripts/environments/cli.mjs ${command} --help。`,
        );
      supplied[name] = value;
    }
  }
  if (supplied.input) {
    let raw;
    if (supplied.input === "-") {
      raw = "";
      for await (const chunk of stdin) {
        raw += chunk;
        if (raw.length > 65536)
          throw new EnvironmentError("标准输入超过 64 KiB。");
      }
    } else raw = await readFile(supplied.input, "utf8");
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new EnvironmentError("参数文件必须是 JSON 对象。");
    for (const [key, value] of Object.entries(input)) {
      if (!options[key] || key === "input" || key in supplied)
        throw new EnvironmentError(`参数 ${key} 无效或与命令行重复。`);
      supplied[key] = value;
    }
  }
  const parsed = {};
  for (const [key, option] of Object.entries(options)) {
    let value = supplied[key] ?? option.default;
    if (option.required && value === undefined)
      throw new EnvironmentError(
        `缺少 --${key}。请执行 node scripts/environments/cli.mjs ${command} --help。`,
      );
    if (value === undefined) continue;
    if (option.type === "number") {
      value = Number(value);
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new EnvironmentError(`--${key} 必须是正整数。`);
    } else if (option.type.startsWith("boolean")) {
      if (![true, false, "true", "false"].includes(value))
        throw new EnvironmentError(`--${key} 可用值：true、false。`);
      value = value === true || value === "true";
    } else if (typeof value !== "string" || !value)
      throw new EnvironmentError(`--${key} 必须是非空字符串。`);
    if (option.choices && !option.choices.includes(value))
      throw new EnvironmentError(
        `--${key} 可用值：${option.choices.join("、")}。`,
      );
    parsed[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
      value;
  }
  return { command, options: parsed };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const parsed = await parseCommand(argv);
    if (parsed.help) {
      process.stdout.write(parsed.help);
      return 0;
    }
    const { executeCommand } = await import("./operations.mjs");
    const result = await executeCommand(parsed.command, parsed.options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode ?? 2;
  }
}

if (
  process.argv[1] &&
  (await realpath(process.argv[1])) ===
    (await realpath(fileURLToPath(import.meta.url)))
)
  process.exitCode = await main();
