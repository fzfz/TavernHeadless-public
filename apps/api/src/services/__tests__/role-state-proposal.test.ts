import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// The production proposal evaluator is an ESM JavaScript module.
// @ts-expect-error The module intentionally has no generated TypeScript declaration.
import { applyProposal } from "../role-state-proposal.mjs";

const Ajv = createRequire(import.meta.url)("ajv");
const schema = JSON.parse(readFileSync(join(
  resolve(import.meta.dirname, "../../../../../"),
  "docs/character-authoring/state-update.schema.json",
), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateOutput = ajv.compile({
  definitions: schema.definitions,
  $ref: "#/definitions/agentOutput",
});
const validateState = ajv.compile({
  type: "object",
  required: ["hp", "nested"],
  additionalProperties: false,
  properties: {
    hp: { type: "integer", minimum: 0 },
    nested: {
      type: "object",
      required: ["value"],
      additionalProperties: false,
      properties: { value: { type: "integer" } },
    },
  },
});
const before = { hp: 1, nested: { value: 2 } };

describe("role state proposal", () => {
  it("applies set and remove operations without mutating the fixed before value", () => {
    const result = applyProposal(
      before,
      {
        changes: [
          { op: "set", path: "/hp", value: 3 },
          { op: "remove", path: "/nested/value" },
        ],
        evidenceMessageIds: ["message-1"],
      },
      profile({ writablePaths: ["/hp", "/nested/value"] }),
      validateOutput,
      () => true,
      ["message-1"],
    );

    expect(result).toEqual({ hp: 3, nested: {} });
    expect(before).toEqual({ hp: 1, nested: { value: 2 } });
  });

  it.each([
    {
      name: "invalid output shape",
      output: { changes: [] },
      expected: "STATE_OUTPUT_INVALID",
    },
    {
      name: "undeclared facts",
      output: { changes: [], evidenceMessageIds: [], facts: {} },
      expected: "STATE_FACTS_UNDECLARED",
    },
    {
      name: "missing evidence",
      output: { changes: [{ op: "set", path: "/hp", value: 2 }], evidenceMessageIds: [] },
      expected: "STATE_EVIDENCE_REQUIRED",
    },
    {
      name: "unknown evidence",
      output: { changes: [], evidenceMessageIds: ["unknown"] },
      expected: "STATE_EVIDENCE_INVALID",
    },
  ])("rejects $name", ({ output, expected }) => {
    expect(() => applyProposal(
      before,
      output,
      profile(),
      validateOutput,
      validateState,
      ["message-1"],
    )).toThrow(expected);
  });

  it("validates declared facts and requires evidence for a facts proposal", () => {
    const validateFacts = Object.assign(
      (value: unknown) => typeof value === "object" && value !== null && "summary" in value,
      { errors: [{ keyword: "required" }] },
    );
    const factsProfile = profile({
      factsSchema: { type: "object" },
      validateFacts,
    });

    expect(() => applyProposal(
      before,
      { changes: [], evidenceMessageIds: ["message-1"], facts: {} },
      factsProfile,
      validateOutput,
      validateState,
      ["message-1"],
    )).toThrow("STATE_FACTS_INVALID");
    expect(() => applyProposal(
      before,
      { changes: [], evidenceMessageIds: [], facts: { summary: "fact" } },
      factsProfile,
      validateOutput,
      validateState,
      ["message-1"],
    )).toThrow("STATE_EVIDENCE_REQUIRED");
  });

  it.each([
    {
      name: "overlapping paths",
      changes: [
        { op: "set", path: "/nested", value: { value: 3 } },
        { op: "set", path: "/nested/value", value: 4 },
      ],
      overrides: { writablePaths: ["/nested", "/nested/value"] },
      expected: "STATE_PATH_OVERLAP",
    },
    {
      name: "derived path writes",
      changes: [{ op: "set", path: "/nested/value", value: 4 }],
      overrides: { writablePaths: ["/nested/value"], derivedPaths: ["/nested"] },
      expected: "STATE_DERIVED_WRITE",
    },
    {
      name: "forbidden paths",
      changes: [{ op: "set", path: "/nested/value", value: 4 }],
      overrides: { writablePaths: ["/hp"] },
      expected: "STATE_PATH_FORBIDDEN",
    },
    {
      name: "missing paths",
      changes: [{ op: "set", path: "/missing/value", value: 4 }],
      overrides: { writablePaths: ["/missing/value"] },
      expected: "STATE_PATH_MISSING",
    },
  ])("rejects $name", ({ changes, overrides, expected }) => {
    expect(() => applyProposal(
      before,
      { changes, evidenceMessageIds: ["message-1"] },
      profile(overrides),
      validateOutput,
      validateState,
      ["message-1"],
    )).toThrow(expected);
  });

  it("runs derive and validate with frozen source context", () => {
    const derive = vi.fn((context) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.sourceMessages)).toBe(true);
      return { ...context.candidate, hp: context.candidate.hp + context.facts.delta };
    });
    const validate = vi.fn((context) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(context.candidate.hp).toBe(4);
      return { issues: [] };
    });
    const result = applyProposal(
      before,
      {
        changes: [{ op: "set", path: "/hp", value: 2 }],
        evidenceMessageIds: ["message-1"],
        facts: { delta: 2 },
      },
      profile({
        factsSchema: { type: "object" },
        validateFacts: () => true,
        derive,
        validate,
      }),
      validateOutput,
      validateState,
      ["message-1"],
      [{ messageId: "message-1", text: "evidence" }],
    );

    expect(result.hp).toBe(4);
    expect(derive).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "schema-invalid candidate",
      changes: [{ op: "set", path: "/hp", value: -1 }],
      overrides: {},
      expected: "STATE_SCHEMA_INVALID",
    },
    {
      name: "invalid validator result",
      changes: [],
      overrides: { validate: () => null },
      expected: "STATE_VALIDATOR_INVALID",
    },
    {
      name: "validator issues",
      changes: [],
      overrides: { validate: () => ({ issues: [{ path: "/hp", message: "invalid" }] }) },
      expected: "STATE_RULE_INVALID",
    },
  ])("rejects $name", ({ changes, overrides, expected }) => {
    expect(() => applyProposal(
      before,
      { changes, evidenceMessageIds: changes.length ? ["message-1"] : [] },
      profile(overrides),
      validateOutput,
      validateState,
      ["message-1"],
    )).toThrow(expected);
  });
});

function profile(overrides: Record<string, unknown> = {}) {
  return {
    writablePaths: ["/hp"],
    derivedPaths: [],
    ...overrides,
  };
}
