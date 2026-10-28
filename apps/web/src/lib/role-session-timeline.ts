import type { TimelineFloor, TimelineMessage } from "@tavern/sdk";

/** Returns the visible messages for a floor in page and message order. */
export function roleSessionTimelineMessages(
  floor: TimelineFloor,
): TimelineMessage[] {
  return [...floor.activePages]
    .sort((left, right) => left.pageNo - right.pageNo)
    .flatMap((page) =>
      [...page.messages].sort((left, right) => left.seq - right.seq),
    );
}
