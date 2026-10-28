export type NativeCardEditorAction = "check" | "preview" | "publish" | "build";
type SaveActionLabelKey = "saveAndCheck" | "saveAndPreview" | "saveAndPublish" | "saveAndBuild";

const actionLabels: Record<NativeCardEditorAction, SaveActionLabelKey> = {
  check: "saveAndCheck",
  preview: "saveAndPreview",
  publish: "saveAndPublish",
  build: "saveAndBuild",
};

export function saveAndContinueLabel(
  action: NativeCardEditorAction | undefined,
  labels: Record<SaveActionLabelKey, string> & { saveAndLeave: string },
): string {
  return action ? labels[actionLabels[action]] : labels.saveAndLeave;
}

export async function saveThenRunAction(
  action: NativeCardEditorAction,
  save: () => Promise<boolean>,
  run: (action: NativeCardEditorAction) => Promise<void>,
): Promise<boolean> {
  if (!await save()) return false;
  await run(action);
  return true;
}
