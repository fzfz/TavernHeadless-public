import http from "node:http";
import { watchValue } from "../../../packages/shared/watch-source.mjs";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: "ok", watchValue }));
});
server.listen(Number(process.env.PORT), process.env.HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
