import { llmModelSlots, stateUpdaterSlot, type NativeCardSystemConfiguration } from "@tavern/shared";

export interface NativeCardSystemConfigurationDraft {
  presetId: string;
  presetVersionId: string;
  defaultUserId: string;
  promptMode: NativeCardSystemConfiguration["promptMode"];
  narratorProfileId: string;
  stateUpdateRequired: boolean;
  stateUpdaterProfileId?: string;
  statePresetId?: string;
  statePresetVersionId?: string;
  stateHistoryTurns?: number;
}

export function buildNativeCardSystemConfiguration(
  draft: NativeCardSystemConfigurationDraft,
): NativeCardSystemConfiguration | undefined {
  const narratorSlot = llmModelSlots.find((slot) => slot === "narrator");
  if (!narratorSlot || !draft.presetId || !draft.presetVersionId || !draft.defaultUserId || !draft.narratorProfileId) {
    return undefined;
  }

  const modelSlots: NativeCardSystemConfiguration["modelSlots"] = [
    { slot: narratorSlot, profile_id: draft.narratorProfileId },
  ];
  if (draft.stateUpdateRequired) {
    if (!draft.stateUpdaterProfileId) return undefined;
    if (Boolean(draft.statePresetId) !== Boolean(draft.statePresetVersionId)) return undefined;
    modelSlots.push({ slot: stateUpdaterSlot, profile_id: draft.stateUpdaterProfileId });
  }

  return {
    presetId: draft.presetId,
    presetVersionId: draft.presetVersionId,
    defaultUserId: draft.defaultUserId,
    promptMode: draft.promptMode,
    modelSlots,
    ...(draft.statePresetId && draft.statePresetVersionId
      ? {
          statePresetId: draft.statePresetId,
          statePresetVersionId: draft.statePresetVersionId,
        }
      : {}),
    ...(draft.stateHistoryTurns === undefined
      ? {}
      : { stateHistoryTurns: draft.stateHistoryTurns }),
  };
}
