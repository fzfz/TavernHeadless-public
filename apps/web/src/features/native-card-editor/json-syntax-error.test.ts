import { describe, expect, it } from "vitest";
import { formatJsonSyntaxError, jsonSyntaxErrorLocation } from "./json-syntax-error.js";

describe("JSON syntax error locations", () => {
  it("uses the end of the file for incomplete JSON and reports one-based line and column", () => {
    expect(jsonSyntaxErrorLocation('{"uid":', new SyntaxError("Unexpected end of JSON input"))).toEqual({
      line: 1, column: 8, message: "Unexpected end of JSON input",
    });
    expect(formatJsonSyntaxError('{"uid":', new SyntaxError("Unexpected end of JSON input"))).toContain("第 1 行第 8 列");
  });

  it("converts parser offsets to a one-based location after multiple lines", () => {
    expect(jsonSyntaxErrorLocation('{\n  "uid": x\n}', new SyntaxError("Unexpected token at position 10"))).toMatchObject({ line: 2, column: 9 });
  });

  it("uses an explicit parser line and column when provided", () => {
    expect(jsonSyntaxErrorLocation("{}", new SyntaxError("Invalid JSON at line 3 column 5"))).toMatchObject({ line: 3, column: 5 });
  });
});
