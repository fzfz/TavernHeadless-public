/**
 * Floor Lineage Service
 *
 * 专职的 floor ancestry 解析层。只负责从 `floor` 表读取 lineage 必须的最小字段，
 * 并对外提供 ancestry 级别的查询能力。具体业务读取接口（branch diff、history loader、
 * timeline 等）通过这一层获得统一语义，不再各自按 `floorNo` 推断共享历史或 fork 点。
 *
 * 约束：
 * - `floorNo` 只作展示与排序，不作 ancestry 身份键。
 * - ancestry 身份以真实 `floorId` 为准，通过 `parentFloorId` 链回溯。
 * - `branchAncestryFloorIdsQuery()` 在数据库中选择分支固定的祖先。
 */

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { floors } from "../db/schema.js";

/**
 * lineage 解析所需的楼层元数据投影。
 *
 * 故意保持最小字段集，避免 lineage 服务层被其它业务语义污染。
 */
export interface FloorLineageNode {
  id: string;
  sessionId: string;
  branchId: string;
  floorNo: number;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  supersededAt: number | null;
}

export interface FloorBranchDiff {
  /** base branch 的 tip floor。若 branch 不存在则为 null。 */
  baseTip: FloorLineageNode | null;
  /** target branch 的 tip floor。若 branch 不存在则为 null。 */
  targetTip: FloorLineageNode | null;
  /**
   * 最近共同祖先 floor。
   *
   * 仅当两个 branch 的 ancestry 链在某个 `floorId` 上真实相交时才有值。
   * 两 branch 的 `floorNo` 相同但 ancestry 不同时，该字段保持为 null。
   */
  forkFloor: FloorLineageNode | null;
  /** shared ancestry 段。从靠近 fork 的位置向上遍历。 */
  sharedFloors: FloorLineageNode[];
  /** base branch 独占的 ancestry 段（不含 fork）。 */
  baseOnlyFloors: FloorLineageNode[];
  /** target branch 独占的 ancestry 段（不含 fork）。 */
  targetOnlyFloors: FloorLineageNode[];
}

const DEFAULT_STATES: FloorLineageNode["state"][] = ["committed"];

export class FloorLineageService {
  constructor(private readonly db: AppDb) {}

  branchAncestryFloorIdsQuery(
    sessionId: string,
    branchId: string,
    states: FloorLineageNode["state"][] = DEFAULT_STATES,
  ): SQL {
    const anchorState = states.length
      ? sql`AND ${inArray(sql`state`, states)}`
      : sql.empty();
    const ancestorState = states.length
      ? sql`AND ${inArray(sql`ancestor.state`, states)}`
      : sql.empty();
    return sql`(
      WITH RECURSIVE branch_lineage(id, parent_floor_id, branch_id, floor_no, superseded_at) AS (
        SELECT id, parent_floor_id, branch_id, floor_no, superseded_at FROM floor
        WHERE session_id = ${sessionId} AND id = COALESCE(
          (SELECT id FROM floor WHERE session_id = ${sessionId} AND branch_id = ${branchId}
            ${anchorState} AND superseded_at IS NULL ORDER BY floor_no DESC, created_at DESC LIMIT 1),
          (SELECT source_floor_id FROM session_branch WHERE session_id = ${sessionId} AND branch_id = ${branchId} LIMIT 1)
        )
        UNION
        SELECT ancestor.id, ancestor.parent_floor_id, ancestor.branch_id, ancestor.floor_no, ancestor.superseded_at
          FROM floor AS ancestor JOIN branch_lineage AS child ON ancestor.id = child.parent_floor_id
          WHERE ancestor.session_id = ${sessionId} ${ancestorState}
      )
      SELECT node.id FROM branch_lineage AS node
        WHERE (node.superseded_at IS NULL OR node.branch_id <> ${branchId})
        AND NOT EXISTS (SELECT 1 FROM branch_lineage AS replacement
          WHERE replacement.parent_floor_id = node.id AND replacement.branch_id = node.branch_id
            AND replacement.floor_no = node.floor_no)
    )`;
  }

  private loadComparisonChain(
    sessionId: string,
    branchId: string,
  ): FloorLineageNode[] {
    return this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
        supersededAt: floors.supersededAt,
      })
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          sql`${floors.id} IN ${this.branchAncestryFloorIdsQuery(sessionId, branchId, [])}`,
        ),
      )
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .all();
  }

  computeBranchDiff(
    sessionId: string,
    baseBranchId: string,
    targetBranchId: string,
  ): FloorBranchDiff {
    const baseChain = this.loadComparisonChain(sessionId, baseBranchId);
    const targetChain = this.loadComparisonChain(sessionId, targetBranchId);
    const baseTip =
      baseChain.find(
        (node) => node.branchId === baseBranchId && node.supersededAt === null,
      ) ?? null;
    const targetTip =
      targetChain.find(
        (node) =>
          node.branchId === targetBranchId && node.supersededAt === null,
      ) ?? null;
    const baseIds = new Set(baseChain.map((node) => node.id));
    const forkIndexInTarget = targetChain.findIndex((node) =>
      baseIds.has(node.id),
    );
    const forkFloor = targetChain[forkIndexInTarget] ?? null;
    const forkIndexInBase = forkFloor
      ? baseChain.findIndex((node) => node.id === forkFloor.id)
      : -1;
    return {
      baseTip,
      targetTip,
      forkFloor,
      sharedFloors:
        forkIndexInBase >= 0 ? baseChain.slice(forkIndexInBase) : [],
      baseOnlyFloors:
        forkIndexInBase >= 0 ? baseChain.slice(0, forkIndexInBase) : baseChain,
      targetOnlyFloors:
        forkIndexInTarget >= 0
          ? targetChain.slice(0, forkIndexInTarget)
          : targetChain,
    };
  }
}
