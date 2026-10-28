#!/usr/bin/env node
import http from "node:http";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      environment: process.env.TAVERN_ENVIRONMENT,
      hmrHost: process.env.TAVERN_HMR_HOST,
      allowedHosts: JSON.parse(process.env.TAVERN_ALLOWED_HOSTS ?? "[]"),
      hmrPort: Number(process.env.TAVERN_HMR_PORT),
      secretPresent: process.env.API_KEY !== undefined,
    }),
  );
});
server.listen(
  Number(process.env.TAVERN_VITE_PORT),
  process.env.TAVERN_VITE_HOST,
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
