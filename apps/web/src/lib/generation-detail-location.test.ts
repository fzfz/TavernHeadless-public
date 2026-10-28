import { expect, it, vi } from "vitest";
import type { TavernClient } from "@tavern/sdk";
import { loadGenerationDetailLocation } from "./generation-detail-location.js";

const location = {
  sessionId: "s",
  branchId: "b",
  floorId: "f",
  runId: "r",
  pageId: "p",
  callId: "c",
};
function setup() {
  const floor = vi.fn().mockResolvedValue({
    id: "f",
    sessionId: "s",
    branchId: "b",
    floorNo: 1,
    createdAt: 1,
    state: "failed",
    tokenIn: 1,
    tokenOut: 0,
    parentFloorId: null,
    supersededAt: null,
    supersededByFloorId: null,
    updatedAt: 1,
  });
  const page = vi.fn().mockResolvedValue({ floorId: "f" });
  const call = vi.fn().mockResolvedValue({ call: { ...location } });
  const client = {
    floors: { getDetail: floor },
    pages: { getDetail: page },
    modelCalls: { get: call },
  } as unknown as TavernClient;
  return { client, floor, page, call };
}
it("loads a saved detail location and its selected call", async () => {
  const { client, floor, page, call } = setup();
  const result = await loadGenerationDetailLocation(client, location);
  expect(result.location).toEqual(location);
  expect(result.floor).toMatchObject({ id: "f", state: "failed" });
  expect(floor).toHaveBeenCalledWith({ floorId: "f" });
  expect(page).toHaveBeenCalledWith({ pageId: "p" });
  expect(call).toHaveBeenCalledWith({ floorId: "f", callId: "c" });
});
it("rejects incomplete locations before requesting resources", async () => {
  const { client, floor } = setup();
  await expect(
    loadGenerationDetailLocation(client, { floorId: "f" }),
  ).rejects.toMatchObject({ code: "GENERATION_DETAIL_LOCATION_INVALID" });
  expect(floor).not.toHaveBeenCalled();
});
it.each(["sessionId", "branchId"])(
  "rejects a foreign floor %s",
  async (field) => {
    const { client, floor, page } = setup();
    floor.mockResolvedValue({
      sessionId: "s",
      branchId: "b",
      [field]: "other",
    });
    await expect(
      loadGenerationDetailLocation(client, location),
    ).rejects.toMatchObject({ code: "GENERATION_DETAIL_LOCATION_INVALID" });
    expect(page).not.toHaveBeenCalled();
  },
);
it("rejects a page from another floor", async () => {
  const { client, page, call } = setup();
  page.mockResolvedValue({ floorId: "other" });
  await expect(
    loadGenerationDetailLocation(client, location),
  ).rejects.toMatchObject({ code: "GENERATION_DETAIL_LOCATION_INVALID" });
  expect(call).not.toHaveBeenCalled();
});
it.each(["sessionId", "branchId", "floorId", "runId"])(
  "rejects mismatched call %s",
  async (field) => {
    const { client, call } = setup();
    call.mockResolvedValue({ call: { ...location, [field]: "other" } });
    await expect(
      loadGenerationDetailLocation(client, location),
    ).rejects.toMatchObject({ code: "GENERATION_DETAIL_LOCATION_INVALID" });
  },
);
it("supports a floor location without a selected page or call", async () => {
  const { client, page, call } = setup();
  await loadGenerationDetailLocation(client, {
    sessionId: "s",
    branchId: "b",
    floorId: "f",
  });
  expect(page).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it("preserves API access errors", async () => {
  const { client, floor } = setup();
  const error = new Error("access denied");
  floor.mockRejectedValue(error);
  await expect(loadGenerationDetailLocation(client, location)).rejects.toBe(
    error,
  );
});
