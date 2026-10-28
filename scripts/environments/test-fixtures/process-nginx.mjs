#!/usr/bin/env node
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const path = process.argv[process.argv.indexOf("-c") + 1];
const config = await readFile(path, "utf8");
const invalid = await access(join(dirname(path), "fail")).then(
  () => true,
  () => false,
);
if (invalid) process.exit(1);
if (
  await access(join(dirname(path), "hold")).then(
    () => true,
    () => false,
  )
)
  await delay(500);
if (!process.argv.includes("-t")) {
  const ports = [
    ...new Set(
      [...config.matchAll(/listen 127\.0\.0\.1:(\d+)/g)].map((match) =>
        Number(match[1]),
      ),
    ),
  ];
  const servers = ports.map((port) => {
    const server = http.createServer((request, response) => {
      response.writeHead(request.url === "/healthz" ? 204 : 200);
      response.end(request.url === "/healthz" ? "" : "fixture");
    });
    server.listen(port, "127.0.0.1");
    return server;
  });
  process.on("SIGQUIT", () => {
    let pending = servers.length;
    for (const server of servers)
      server.close(() => {
        if (--pending === 0) process.exit(0);
      });
  });
}
