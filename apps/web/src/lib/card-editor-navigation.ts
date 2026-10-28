import type { NativeCard } from "@tavern/shared";
import type { CharacterListItem } from "@tavern/sdk";

type NativeCardReference = Pick<NativeCard, "id" | "characterId">;
type CharacterReference = Pick<CharacterListItem, "id" | "status">;

export function packageBackedCharacters<TCharacter extends CharacterReference>(
  characters: readonly TCharacter[],
  cards: readonly NativeCardReference[],
): TCharacter[] {
  const characterIds = new Set(cards.map((card) => card.characterId));
  return characters.filter(
    (character) =>
      character.status === "active" && characterIds.has(character.id),
  );
}

export function nativeCardEditorHref(
  editorPath: string,
  cards: readonly NativeCardReference[],
  characterId?: string,
): string | undefined {
  if (!characterId) return editorPath;
  const card = cards.find((item) => item.characterId === characterId);
  if (!card) return undefined;
  return `${editorPath}?id=${encodeURIComponent(card.id)}`;
}
