export interface JsonSyntaxErrorLocation {
  line: number;
  column: number;
  message: string;
}

export function jsonSyntaxErrorLocation(
  content: string,
  error: unknown,
): JsonSyntaxErrorLocation {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumn?.[1] && lineColumn[2]) {
    return { line: Number(lineColumn[1]), column: Number(lineColumn[2]), message };
  }
  const position = message.match(/position\s+(\d+)/i);
  const offset = position?.[1]
    ? Number(position[1])
    : /unexpected end|unterminated|end of json/i.test(message)
      ? content.length
      : 0;
  const boundedOffset = Math.max(0, Math.min(offset, content.length));
  const before = content.slice(0, boundedOffset);
  const line = before.split("\n").length;
  const lastLineBreak = before.lastIndexOf("\n");
  return { line, column: boundedOffset - lastLineBreak, message };
}

export function formatJsonSyntaxError(content: string, error: unknown): string {
  const location = jsonSyntaxErrorLocation(content, error);
  return `第 ${location.line} 行第 ${location.column} 列：${location.message}`;
}
