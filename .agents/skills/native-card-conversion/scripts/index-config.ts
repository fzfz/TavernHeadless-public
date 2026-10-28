import { taskPaths } from "./source-config.ts";

export const indexSchemas = {
  character: taskPaths.characterSchema,
  openings: "native-card-package/openings.schema.json",
  frontend: "native-card-package/frontend-manifest.schema.json",
} as const;

export const indexMessages = {
  arguments:
    "index 需要 taskFile；启用前端时添加 --frontend 及前端 manifest 的包内相对路径。",
  task: "任务文件应提供有效的 id 和 packageDirectory，请使用 begin 返回的 taskFile。",
  link: "包目录含符号链接，请使用普通目录和文件。",
  fileType: "包内只能保存普通文件和目录。",
  unknownPath: "文件路径不符合原生包规则，请修改路径或移出包目录。",
  mediaType: "资源扩展名没有对应的正式媒体类型，支持的扩展名为：{extensions}。",
  frontend: "前端入口路径应为 {path}，请修改 --frontend 参数。",
} as const;
