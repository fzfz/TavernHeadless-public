import type { FloorRecord, TavernClient, TimelineFloor } from "@tavern/sdk";

async function listAll<T>(
  pageSize: number,
  loadPage: (offset: number, limit: number) => Promise<T[]>,
  isCurrent: () => boolean,
): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; isCurrent(); offset += pageSize) {
    const page = await loadPage(offset, pageSize);
    if (!isCurrent()) return [];
    items.push(...page);
    if (page.length < pageSize) return items;
  }
  return [];
}

export async function listGenerationDetailFloors(
  client: TavernClient,
  sessionId: string,
  pageSize: number,
  isCurrent: () => boolean = () => true,
): Promise<FloorRecord[]> {
  const floors = await listAll(
    pageSize,
    (offset, limit) =>
      client.floors.list({
        sessionId,
        limit,
        offset,
        sortBy: "floor_no",
        sortOrder: "desc",
      }),
    isCurrent,
  );
  if (!isCurrent()) return [];
  return floors.sort(
    (left, right) =>
      right.floorNo - left.floorNo || right.createdAt - left.createdAt,
  );
}

export function toGenerationDetailFloorOption(
  floor: FloorRecord,
): TimelineFloor {
  return {
    ...floor,
    activePage: null,
    activePages: [],
    messages: [],
    pageCount: 0,
    pages: [],
  };
}

export async function loadGenerationDetailFloor(
  client: TavernClient,
  floor: FloorRecord,
  pageSize: number,
  isCurrent: () => boolean = () => true,
): Promise<TimelineFloor | null> {
  const pageRecords = await listAll(
    pageSize,
    (offset, limit) =>
      client.pages.list({
        floorId: floor.id,
        limit,
        offset,
        sortBy: "page_no",
        sortOrder: "asc",
      }),
    isCurrent,
  );
  if (!isCurrent()) return null;

  const pages = await Promise.all(
    pageRecords.map(async (page) => {
      const messages = await listAll(
        pageSize,
        (offset, limit) =>
          client.messages.list({
            pageId: page.id,
            limit,
            offset,
            sortBy: "seq",
            sortOrder: "asc",
          }),
        isCurrent,
      );
      return { ...page, messages };
    }),
  );
  if (!isCurrent()) return null;
  const activePages = pages.filter((page) => page.isActive);
  return {
    ...floor,
    activePage: activePages.length === 1 ? activePages[0]! : null,
    activePages,
    messages: activePages.flatMap((page) =>
      page.messages.filter((message) => !message.isHidden),
    ),
    pageCount: pages.length,
    pages,
  };
}
