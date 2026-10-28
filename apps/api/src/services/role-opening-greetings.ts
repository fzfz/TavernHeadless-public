import {
  getGreetingCandidates,
  getPrimaryGreeting,
  type SessionCharacterSnapshot,
} from "../lib/character-snapshot.js";
import { roleOpeningsSchema } from "./role-character-extension-schema.js";
import {
  evaluateStMacros,
  type StMacroVariableSnapshot,
} from "./st-macros/index.js";

export type RoleOpeningPersona = {
  name?: string;
  description?: string;
};

export function renderRoleOpeningGreetingCandidates(
  snapshot: SessionCharacterSnapshot | undefined,
  persona: RoleOpeningPersona | undefined,
  selectedOpeningId?: string,
): string[] {
  const greetingCandidates = getGreetingCandidates(snapshot);
  if (!snapshot) return greetingCandidates;

  const rawExtension = snapshot.extensions?.tavern_headless;
  const extension =
    rawExtension && typeof rawExtension === "object"
      ? (rawExtension as Record<string, unknown>)
      : undefined;
  const openings =
    extension?.openings === undefined
      ? []
      : roleOpeningsSchema.parse(extension.openings).items;
  if (extension?.nativePackage && selectedOpeningId) {
    const opening = openings.find((item) => item.id === selectedOpeningId);
    if (!opening) throw new Error(`Native opening ${selectedOpeningId} is missing from the session snapshot.`);
    return [
      evaluateStMacros(opening.displayText, {
        phase: "preview",
        values: {
          user: persona?.name ?? "",
          char: snapshot.name,
          persona: persona?.description ?? "",
        },
        variableSnapshot: {
          local: { stat_data: opening.variables },
          global: {},
          plain: {},
        },
      }).text,
    ];
  }
  const hasPrimaryGreeting = Boolean(getPrimaryGreeting(snapshot));

  return greetingCandidates.map((text, index) => {
    const openingId =
      hasPrimaryGreeting && index === 0
        ? "first"
        : `alternate-${hasPrimaryGreeting ? index : index + 1}`;
    const opening = openings.find((item) => item.id === openingId);
    const variableSnapshot: StMacroVariableSnapshot = {
      local: { stat_data: opening?.variables ?? {} },
      global: {},
      plain: {},
    };
    return evaluateStMacros(opening?.displayText ?? text, {
      phase: "preview",
      values: {
        user: persona?.name ?? "",
        char: snapshot.name,
        persona: persona?.description ?? "",
      },
      variableSnapshot,
    }).text;
  });
}
