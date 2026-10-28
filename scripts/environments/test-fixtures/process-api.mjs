import http from "node:http";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

if (process.argv.includes("status")) {
  if (process.env.FIXTURE_WAIT_MS)
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.FIXTURE_WAIT_MS)),
    );
  const output = process.argv[process.argv.indexOf("--output") + 1];
  const ready = process.env.FIXTURE_READY !== "false";
  console.log(`fixture ${process.env.API_KEY || ""}`);
  if (process.env.FIXTURE_SKIP_OUTPUT !== "true")
    await writeFile(
      output,
      JSON.stringify({
        ready,
        dataDirectory: process.argv.includes("--data-directory")
          ? process.argv[process.argv.indexOf("--data-directory") + 1]
          : null,
      }),
    );
  if (!ready) process.exitCode = 3;
} else {
  if (process.env.FIXTURE_CHILD === "true")
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        environment: process.env.TAVERN_ENVIRONMENT,
      }),
    );
  });
  server.listen(Number(process.env.PORT), process.env.HOST);
  console.log(`fixture ${process.env.API_KEY || ""}`);
  process.on("SIGTERM", () =>
    setTimeout(
      () => server.close(() => process.exit(0)),
      Number(process.env.FIXTURE_STOP_WAIT_MS || 0),
    ),
  );
}
