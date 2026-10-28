import {
  RoleModelCapabilitiesToolProvider,
  ToolRegistry,
  ToolExecutor,
  createEventBus,
} from "@tavern/core";

import config from "../../../../apps/api/config/role-model-capabilities.json" with { type: "json" };
import { roleModelCapabilitiesSystemConfigSchema, type RoleModelCapabilitiesGrant } from "@tavern/shared";
const systemConfig = roleModelCapabilitiesSystemConfigSchema.parse(config);
const grant: RoleModelCapabilitiesGrant = { enabled: true, allowed: ["random", "calculate"], slot: "narrator", transport: "text_protocol" };
const registry = new ToolRegistry();
registry.register(new RoleModelCapabilitiesToolProvider({ systemConfig, grant, resolveGrant: () => grant }));
const bus = createEventBus();
const executor = new ToolExecutor(registry, bus);
const context = {
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  callerSlot: "narrator" as const,
  variableContext: {
    sessionId: "session-1",
    branchId: "main",
    floorId: "floor-1",
  },
};
const permissions = { enabled: true, maxCallsPerTurn: 5 };
const completed: string[] = [];
const stop = bus.on("tool.call_completed", (event) => {
  completed.push(event.toolName);
});
const success = await executor.execute(
  "random",
  { domain: { kind: "integer_range", min: 1, max: 1 }, distribution: { kind: "uniform" }, count: 2, replacement: true },
  context,
  permissions,
);
const failure = await executor.execute(
  "calculate",
  { expression: { op: "div", args: [1, 0] } },
  context,
  permissions,
);
const denied = await executor.execute("random", {}, context, {
  enabled: false,
});
stop();
console.log(
  JSON.stringify(
    {
      success: success.data,
      failure: { status: failure.executionStatus, error: failure.error },
      denied: denied.denied,
      completed,
      records: executor
        .getExecutionRecords()
        .map((record) => ({
          toolName: record.toolName,
          status: record.status,
        })),
    },
    null,
    2,
  ),
);
