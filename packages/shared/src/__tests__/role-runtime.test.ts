import { describe, expect, it } from "vitest";

import { resourcePolicy } from "../generated/role-runtime-validators.js";
import {
  decodeRoleHistoryCursor,
  encodeRoleHistoryCursor,
} from "../role-runtime-history-cursor.js";
import {
  roleRuntimeHistoryPagination,
  roleRuntimeHistoryPaginationSchema,
} from "../schemas/role-runtime-history-pagination.js";
import { roleDeliverySchema, roleFloorPageSchema } from "../schemas/role-view.js";

describe("layout display contracts", () => {
  it.each([0, 25, 50.5, 100, 150])("accepts percentage width %s", (percent) => {
    expect(validators.fillElementUpdate({ percent })).toBe(true);
    expect(validators.layoutPatch({ bar: { percent } })).toBe(true);
  });
  it.each([-1, NaN, Infinity, "50", null])("rejects invalid percentage %s", (percent) => {
    expect(validators.fillElementUpdate({ percent })).toBe(false);
  });
  it("limits percentage to fill and validates animation options", () => {
    expect(validators.containerElementUpdate({ percent: 50 })).toBe(false);
    expect(validators.fillElementUpdate({ value: 50 })).toBe(false);
    expect(validators.layoutRegistration({elements:{bar:{selector:"#bar",kind:"fill"}}})).toBe(true);
    const options = {visible:true,durationMs:300,easing:"swing",queue:"append"};
    expect(validators.visibilityAnimation(options)).toBe(true);
    expect(validators.visibilityAnimation({...options,durationMs:0})).toBe(true);
    for(const durationMs of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "300"])
      expect(validators.visibilityAnimation({...options,durationMs})).toBe(false);
    for(const patch of [{visible:1},{easing:"linear"},{queue:"replace"},{extra:true}])
      expect(validators.visibilityAnimation({...options,...patch})).toBe(false);
    expect(validators.visibilityAnimation({visible:true})).toBe(false);
  });
});

describe("role runtime policy", () => {
  const policy = {
    overscanFloors: 0,
    historyCache: { maxEntries: 1, maxBytes: 1024 },
    settledStreamCache: { maxEntries: 2, maxBytes: 2048 },
    diagnosticsCache: { maxEntries: 10, maxBytes: 4096 },
  };

  it("accepts bounded caches and zero overscan", () => {
    expect(resourcePolicy(policy)).toBe(true);
  });

  it.each([0, -1, 1.5, "2", null])(
    "rejects invalid cache capacity %s",
    (maxEntries) => {
      expect(
        resourcePolicy({
          ...policy,
          historyCache: { ...policy.historyCache, maxEntries },
        }),
      ).toBe(false);
    },
  );

  it("rejects missing limits and unrecognized runtime settings", () => {
    expect(resourcePolicy({ overscanFloors: 0 })).toBe(false);
    expect(resourcePolicy({ ...policy, unknown: true })).toBe(false);
  });
});

describe("role runtime history pagination", () => {
  it("accepts native greeting floor zero and rejects negative floor numbers", () => {
    const greetingPage = {
      items: [{ floorId: "greeting-floor", floorNo: 0, state: "committed" }],
      nextCursor: null,
    };

    expect(roleFloorPageSchema.safeParse(greetingPage).success).toBe(true);
    expect(validators.messagesListFloorsResult(greetingPage)).toBe(true);
    expect(
      roleFloorPageSchema.safeParse({
        items: [{ floorId: "invalid-floor", floorNo: -1, state: "committed" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it("shares bounded pagination settings and scopes cursors to a list", () => {
    expect(roleRuntimeHistoryPagination).toEqual({
      defaultLimit: 20,
      maxLimit: 100,
      maxCursorLength: 2048,
    });
    expect(
      roleRuntimeHistoryPaginationSchema.safeParse(roleRuntimeHistoryPagination)
        .success,
    ).toBe(true);
    expect(
      roleRuntimeHistoryPaginationSchema.safeParse({
        defaultLimit: 101,
        maxLimit: 100,
        maxCursorLength: 2048,
      }).success,
    ).toBe(false);
    const scope = {
      resource: "snapshots" as const,
      sessionId: "session/雪",
      branchId: "branch/a",
    };
    const cursor = encodeRoleHistoryCursor({ ...scope, beforeNo: 0 });
    expect(decodeRoleHistoryCursor(cursor, scope)).toBe(0);
    expect(
      decodeRoleHistoryCursor(cursor, { ...scope, branchId: "other" }),
    ).toBeNull();
    expect(
      decodeRoleHistoryCursor(cursor, { ...scope, resource: "floors" }),
    ).toBeNull();
    expect(decodeRoleHistoryCursor("not-a-cursor", scope)).toBeNull();
    expect(() =>
      encodeRoleHistoryCursor({
        ...scope,
        branchId: "b".repeat(3000),
        beforeNo: 1,
      }),
    ).toThrow();
  });
});

import * as validators from "../generated/role-runtime-validators.js";
it.each([
  ["image", { asset: "portrait", alt: "Portrait" }, { text: "invalid" }],
  ["text", { text: "Body" }, { min: 0 }],
  ["progress", { value: 1, min: 0, max: 10 }, { checked: true }],
  [
    "control",
    { text: "Send", value: "go", disabled: false, checked: true },
    { asset: "image" },
  ],
  ["container", { visible: true, classes: { selected: true } }, { value: 1 }],
] as const)(
  "uses the shared schema for %s layout updates",
  (kind, allowed, disallowed) => {
    const validate = validators[`${kind}ElementUpdate`];
    expect(validate(allowed)).toBe(true);
    expect(validate(disallowed)).toBe(false);
    expect(validate({ visible: "yes" })).toBe(false);
    expect(validate({ classes: { active: 1 } })).toBe(false);
    expect(validate({ unknown: true })).toBe(false);
    expect(validate({})).toBe(true);
  },
);

describe("role delivery modes", () => {
  const delivery = { html: "", css: "", floorHtml: null, assets: {}, data: {} };
  it("accepts explicit system chat without a script and existing custom layouts", () => {
    expect(roleDeliverySchema.safeParse({ ...delivery, mode: "system_chat", scriptUrl: null }).success).toBe(true);
    expect(roleDeliverySchema.safeParse({ ...delivery, scriptUrl: "/entry.js" }).success).toBe(true);
    expect(roleDeliverySchema.safeParse({ ...delivery, mode: "custom", scriptUrl: "/entry.js" }).success).toBe(true);
  });
  it("rejects missing custom scripts and package content in system chat", () => {
    for (const value of [
      { ...delivery, scriptUrl: null },
      { ...delivery, mode: "custom", scriptUrl: "" },
      { ...delivery, mode: "system_chat", scriptUrl: "/entry.js" },
      { ...delivery, mode: "system_chat", scriptUrl: null, html: "<p>custom</p>" },
    ]) expect(roleDeliverySchema.safeParse(value).success).toBe(false);
  });
});
