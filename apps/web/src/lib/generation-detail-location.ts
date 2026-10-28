import {
  apiErrorMessages,
  generationDetailLocationSchema,
} from "@tavern/shared";
import type { TavernClient } from "@tavern/sdk";

export async function loadGenerationDetailLocation(
  client: TavernClient,
  input: unknown,
) {
  const invalid = () =>
    Object.assign(
      new Error(apiErrorMessages.GENERATION_DETAIL_LOCATION_INVALID),
      { code: "GENERATION_DETAIL_LOCATION_INVALID" },
    );
  const result = generationDetailLocationSchema.safeParse(input);
  if (!result.success) throw invalid();
  const location = result.data;
  const floor = await client.floors.getDetail({ floorId: location.floorId });
  if (
    floor.id !== location.floorId ||
    floor.sessionId !== location.sessionId ||
    floor.branchId !== location.branchId
  )
    throw invalid();
  if (location.pageId) {
    const page = await client.pages.getDetail({ pageId: location.pageId });
    if (page.floorId !== location.floorId) throw invalid();
  }
  const selectedCall = location.callId
    ? await client.modelCalls.get({
        floorId: location.floorId,
        callId: location.callId,
      })
    : undefined;
  if (
    selectedCall &&
    (selectedCall.call.sessionId !== location.sessionId ||
      selectedCall.call.branchId !== location.branchId ||
      selectedCall.call.floorId !== location.floorId ||
      (location.runId && selectedCall.call.runId !== location.runId))
  )
    throw invalid();
  return { location, floor, selectedCall };
}
