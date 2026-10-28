import { posix } from "node:path";

import * as ts from "typescript";
import { nativeCardFileRules } from "@tavern/shared";
import type { NativeModuleWorkerRequest } from "./native-module-worker.schema.js";

export type NativeModuleDependency =
  NativeModuleWorkerRequest["modules"][number];

const importRules = nativeCardFileRules.backendModuleApi.imports;

/**
 * 此函数收集入口模块及其递归引用的静态导入和再导出。
 * 函数对每个包内路径仅调用一次 readDependency，循环依赖中的路径也适用。
 * 函数将 JSON 依赖加入结果，并扫描服务端脚本的导入和再导出。
 */
export function collectNativeModuleDependencies(
  entryPath: string,
  readDependency: (path: string) => NativeModuleDependency,
): NativeModuleDependency[] {
  const modules: NativeModuleDependency[] = [];
  const pending = [entryPath];
  const scheduled = new Set(pending);
  let nextPending = 0;

  while (nextPending < pending.length) {
    const path = pending[nextPending]!;
    nextPending += 1;

    const module = readDependency(path);
    modules.push(module);
    if (module.purpose !== "server_script") continue;

    for (const specifier of getStaticModuleSpecifiers(module.source)) {
      const dependencyPath = resolveRelativeModulePath(path, specifier);
      if (scheduled.has(dependencyPath)) continue;
      scheduled.add(dependencyPath);
      pending.push(dependencyPath);
    }
  }

  return modules;
}

function getStaticModuleSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "native-role-module.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const specifiers: string[] = [];

  for (const node of sourceFile.statements) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveRelativeModulePath(
  importerPath: string,
  specifier: string,
): string {
  if (
    (importRules.relativeOnly &&
      !(specifier.startsWith("./") || specifier.startsWith("../"))) ||
    specifier.includes("\\") ||
    specifier.includes("?") ||
    specifier.includes("#")
  ) {
    throw new Error(
      "导入路径必须以“./”或“../”开头，并使用“/”分隔目录；请移除反斜杠、查询参数和片段。",
    );
  }

  const targetPath = posix.normalize(
    posix.join(posix.dirname(importerPath), specifier),
  );
  if (
    targetPath === ".." ||
    targetPath.startsWith("../") ||
    targetPath.startsWith("/")
  )
    throw new Error("相对导入必须指向原生包内的文件。");
  return targetPath;
}
