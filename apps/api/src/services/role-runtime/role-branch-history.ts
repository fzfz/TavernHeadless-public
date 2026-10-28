import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "../../db/client.js";
import { floors } from "../../db/schema.js";
import { FloorLineageService } from "../floor-lineage-service.js";

export function roleBranchFloorFilter(
  db: AppDb,
  sessionId: string,
  branchId: string,
) {
  const own = and(
    eq(floors.sessionId, sessionId),
    eq(floors.branchId, branchId),
    isNull(floors.supersededAt),
  );
  if (branchId === "main") return own;
  const ancestry = new FloorLineageService(db).branchAncestryFloorIdsQuery(
    sessionId,
    branchId,
  );
  return and(
    eq(floors.sessionId, sessionId),
    or(own, sql`${floors.id} IN ${ancestry}`),
  );
}
