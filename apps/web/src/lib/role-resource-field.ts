/** Parse only field types declared by the resource editor configuration. */
export function parseResourceField(
  kind: string,
  input: string,
  checked: boolean,
  current: unknown,
): unknown {
  if (kind === "check") return checked;
  if (kind === "json") return JSON.parse(input);
  if (kind === "placements")
    return input.split(",").filter(Boolean).map(Number);
  if (kind === "tri") return input === "" ? null : input === "true";
  if (Array.isArray(current) && kind === "text")
    return input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (["number", "nullableNumber"].includes(kind))
    return input === "" ? null : Number(input);
  if (typeof current === "number") return Number(input);
  return input;
}
