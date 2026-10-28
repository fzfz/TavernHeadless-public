import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  startReplayFixture,
  type RunningReplayFixture,
} from "./replay-fixture.ts";
const fixtures: RunningReplayFixture[] = [],
  directories: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("同一父目录下八个回放服务分别保存请求及关闭统计", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-isolation-"));
  directories.push(directory);
  const running = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      startReplayFixture(
        {
          host: "127.0.0.1",
          port: 0,
          steps: [
            {
              purpose: "narrator",
              model: `model-${index}`,
              text: `独立输出${index}`,
            },
          ],
        },
        directory,
      ),
    ),
  );
  fixtures.push(...running);
  expect(
    new Set(running.map((fixture) => fixture.evidenceDirectory)).size,
  ).toBe(8);
  await Promise.all(
    running.map(async (fixture, index) => {
      const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: `model-${index}`,
          messages: [{ role: "user", content: `请求${index}` }],
        }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe(
        `独立输出${index}`,
      );
      const text = await readFile(
        join(fixture.evidenceDirectory, "requests.jsonl"),
        "utf8",
      );
      expect(text).toContain(`请求${index}`);
      expect(
        JSON.parse(
          await readFile(
            join(fixture.evidenceDirectory, "summary.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({ configuredSteps: 1 });
    }),
  );
  expect((await readdir(directory)).length).toBe(8);
});
