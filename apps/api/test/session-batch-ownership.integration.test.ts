import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type BuildAppResult } from "./helpers/create-test-db.js";
import { sessions } from "../src/db/schema.js";

let built: BuildAppResult | undefined;
afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

async function fixture() {
  built = await buildTestApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
  });
  const app = built.app;
  const identity = async (email: string) => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: email, email, password: "secure password" },
    });
    expect(register.statusCode, register.body).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "secure password" },
    });
    return {
      id: register.json().data.id as string,
      cookie: String(login.headers["set-cookie"]).split(";")[0]!,
    };
  };
  const a = await identity("a@example.com");
  const b = await identity("b@example.com");
  built.database
    .insert(sessions)
    .values([
      {
        id: "legacy-a",
        accountId: a.id,
        title: "A的演绎",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "legacy-b",
        accountId: b.id,
        title: "B的演绎",
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    .run();
  return { app, a, b };
}

describe("session batch ownership HTTP", () => {
  it("keeps another account legacy session when batch deletion uses its identifier", async () => {
    const { app, a, b } = await fixture();
    const result = await app.inject({
      method: "POST",
      url: "/sessions/batch/delete",
      headers: { cookie: a.cookie },
      payload: { ids: ["legacy-b", "legacy-a"] },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data.results).toEqual([
      { index: 0, id: "legacy-b", action: "not_found" },
      { index: 1, id: "legacy-a", action: "deleted" },
    ]);
    const preserved = await app.inject({
      method: "GET",
      url: "/sessions/legacy-b",
      headers: { cookie: b.cookie },
    });
    expect(preserved.statusCode, preserved.body).toBe(200);
    expect(preserved.json().data.title).toBe("B的演绎");
  });
  it("updates only authorized legacy and project sessions in a mixed batch", async () => {
    const { app, a, b } = await fixture();
    const bProject = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { cookie: b.cookie },
      payload: { title: "B的项目演绎" },
    });
    expect(bProject.statusCode, bProject.body).toBe(201);
    const bProjectId = bProject.json().data.id;
    const result = await app.inject({
      method: "PATCH",
      url: "/sessions/batch/status",
      headers: { cookie: a.cookie },
      payload: {
        ids: ["legacy-a", "legacy-b", bProjectId],
        status: "archived",
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data.meta.updated).toBe(1);
    for (const id of ["legacy-b", bProjectId]) {
      const own = await app.inject({
        method: "GET",
        url: `/sessions/${id}`,
        headers: { cookie: b.cookie },
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json().data.status).toBe("active");
    }
  });
});
