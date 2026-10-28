import { describe, expect, it } from "vitest";

import type { SessionCharacterSnapshot } from "../../lib/character-snapshot.js";
import { renderRoleOpeningGreetingCandidates } from "../role-opening-greetings.js";

describe("renderRoleOpeningGreetingCandidates", () => {
  it("expands user, char, persona and initial stat_data for primary and alternate openings", () => {
    const snapshot = character({
      primaryGreeting: "Raw primary",
      alternateGreetings: ["Raw alternate"],
      extensions: {
        tavern_headless: {
          openings: {
            items: [
              {
                id: "first",
                displayText:
                  "{{user}} meets {{char}}: {{persona}} / {{getvar::stat_data.scene}}",
                variables: { scene: "primary" },
              },
              {
                id: "alternate-1",
                displayText: "{{user}} selects {{getvar::stat_data.scene}}",
                variables: { scene: "alternate" },
              },
            ],
          },
        },
      },
    });

    expect(
      renderRoleOpeningGreetingCandidates(snapshot, {
        name: "Performer",
        description: "Persona description",
      }),
    ).toEqual([
      "Performer meets Character: Persona description / primary",
      "Performer selects alternate",
    ]);
  });

  it("maps alternate openings correctly when the character has no primary greeting", () => {
    const snapshot = character({
      alternateGreetings: ["Raw one", "Raw two"],
      extensions: {
        tavern_headless: {
          openings: {
            items: [
              {
                id: "alternate-1",
                displayText: "First {{getvar::stat_data.value}}",
                variables: { value: 1 },
              },
              {
                id: "alternate-2",
                displayText: "Second {{getvar::stat_data.value}}",
                variables: { value: 2 },
              },
            ],
          },
        },
      },
    });

    expect(renderRoleOpeningGreetingCandidates(snapshot, undefined)).toEqual([
      "First 1",
      "Second 2",
    ]);
  });

  it("returns no greetings without a character snapshot", () => {
    expect(
      renderRoleOpeningGreetingCandidates(undefined, {
        name: "Performer",
        description: "Persona",
      }),
    ).toEqual([]);
  });

  it("rejects malformed opening configuration", () => {
    const snapshot = character({
      primaryGreeting: "Opening",
      extensions: { tavern_headless: { openings: { items: "invalid" } } },
    });
    expect(() => renderRoleOpeningGreetingCandidates(snapshot, undefined)).toThrow();
  });

  it("expands standard macros in ordinary greetings when the role extension is absent", () => {
    const snapshot = character({
      primaryGreeting: "{{user}} greets {{char}}. {{persona}}",
    });

    expect(
      renderRoleOpeningGreetingCandidates(snapshot, {
        name: "Performer",
        description: "Persona text",
      }),
    ).toEqual(["Performer greets Character. Persona text"]);
  });

  it("renders the explicitly selected native package opening and its initial variables", () => {
    const result = renderRoleOpeningGreetingCandidates(
      {
        name: "沈知夏",
        primaryGreeting: "Default opening",
        extensions: {
          tavern_headless: {
            nativePackage: { cardId: "card", revision: 1 },
            openings: {
              items: [
                { id: "first", displayText: "Default opening", variables: { place: "邮局" } },
                { id: "garden", displayText: "{{char}} meets {{user}} at {{getvar::stat_data.place}}.", variables: { place: "花园" } },
              ],
            },
          },
        },
      },
      { name: "裴修远", description: "雾港邮局管理员" },
      "garden",
    );

    expect(result).toEqual(["沈知夏 meets 裴修远 at 花园."]);
  });

  it("keeps the source character snapshot unchanged", () => {
    const snapshot = character({
      primaryGreeting: "Raw",
      extensions: {
        tavern_headless: {
          openings: {
            items: [
              {
                id: "first",
                displayText:
                  "{{setvar::stat_data.scene::changed}}{{getvar::stat_data.scene}}",
                variables: { scene: "initial" },
              },
            ],
          },
        },
      },
    });
    const original = structuredClone(snapshot);

    renderRoleOpeningGreetingCandidates(snapshot, undefined);

    expect(snapshot).toEqual(original);
  });
});

function character(
  overrides: Partial<SessionCharacterSnapshot>,
): SessionCharacterSnapshot {
  return { name: "Character", ...overrides };
}
