import { buildTestApp } from "../../api/test/helpers/create-test-db.js";
const origin = new URL(process.env.USER_WEB_URL ?? "http://127.0.0.1:4190")
  .origin;
const built = await buildTestApp({
  databasePath: ":memory:",
  logger: false,
  auth: { mode: "off" },
  cors: { origins: [origin] },
});
await built.app.listen({
  host: "127.0.0.1",
  port: Number(process.env.USER_WEB_EMPTY_API_PORT ?? 4314),
});
process.once("SIGTERM", () => void built.app.close());
process.once("SIGINT", () => void built.app.close());
