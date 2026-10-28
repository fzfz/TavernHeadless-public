type SrcsetCandidate = { value: string; offset: number };

function isAsciiWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

export function srcsetCandidates(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let offset = 0;
  while (offset < value.length) {
    while (offset < value.length && (isAsciiWhitespace(value[offset]) || value[offset] === ",")) offset += 1;
    if (offset >= value.length) break;

    const start = offset;
    while (offset < value.length && !isAsciiWhitespace(value[offset])) offset += 1;
    const rawUrl = value.slice(start, offset);
    const url = rawUrl.replace(/,+$/, "");
    if (url) candidates.push({ value: url, offset: start });

    if (url !== rawUrl) continue;
    while (offset < value.length && value[offset] !== ",") offset += 1;
    if (value[offset] === ",") offset += 1;
  }
  return candidates;
}

