import {
  historySchema,
  manifestSourceSchema,
} from "./published-history.schema";
import type { PublishedHistorySnapshot } from "./published-history.schema";

export async function loadPublishedHistory(
  siteUrl: string,
  repository: string,
  retention: number,
  request: typeof fetch = fetch,
): Promise<PublishedHistorySnapshot> {
  const response = await request(new URL("agent/history.json", siteUrl));
  if (response.status === 404) {
    return {
      compareBaseCommit: null,
      items: [],
      manifestContents: new Map(),
      state: "first-publication",
    };
  }
  if (!response.ok)
    throw new Error(
      `读取本仓库发布历史失败：HTTP ${response.status}。请检查 ${siteUrl}。`,
    );
  const history = historySchema.parse(await response.json());
  const items = history.items.slice(0, Math.max(retention - 1, 0));
  const manifestContents = new Map<string, string>();
  // Verify the newest source even when retention=1, because it is the comparison base.
  for (const item of history.items.slice(0, Math.max(items.length, 1))) {
    const url = new URL(item.manifest, siteUrl);
    const expected = new URL(`agent/manifests/${item.commit}.json`, siteUrl);
    if (url.href !== expected.href)
      throw new Error(
        "发布历史的 manifest 地址不属于当前站点；请修正该站点的历史记录。",
      );
    const manifestResponse = await request(url);
    if (!manifestResponse.ok)
      throw new Error(
        `读取 ${url.href} 失败：HTTP ${manifestResponse.status}。`,
      );
    const content = await manifestResponse.text();
    const manifest = manifestSourceSchema.parse(JSON.parse(content));
    if (
      manifest.source.repo !== repository ||
      manifest.source.commit !== item.commit
    ) {
      throw new Error(
        "manifest 的仓库或提交与当前发布历史不一致；请修正对应记录。",
      );
    }
    manifestContents.set(item.commit, content);
  }
  return {
    compareBaseCommit: history.items[0]?.commit ?? null,
    items,
    manifestContents,
    state: "existing-publication",
  };
}

export function publicationComparisonBase(
  history: PublishedHistorySnapshot,
  currentCommit: string,
): string | null {
  if (history.compareBaseCommit !== currentCommit)
    return history.compareBaseCommit;
  const previous = manifestSourceSchema.parse(
    JSON.parse(history.manifestContents.get(currentCommit)!),
  );
  return previous.compareBase?.commit ?? null;
}
