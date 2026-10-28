export function createSession(card, persona, opening) {
  return {
    id: crypto.randomUUID(),
    cardId: card.id,
    title: `与${card.name}的故事`,
    persona: structuredClone(persona),
    updatedAt: Date.now(),
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        variants: [card.openings[opening]],
        selected: 0,
      },
    ],
  };
}

export function addReply(message, text) {
  message.variants.push(text);
  message.selected = message.variants.length - 1;
}

export function selectReply(message, offset) {
  message.selected = Math.max(
    0,
    Math.min(message.variants.length - 1, message.selected + offset),
  );
}

export function extendReply(message, text) {
  message.variants[message.selected] += text;
}

export function deleteSessions(sessions, ids) {
  return sessions.filter((session) => !ids.includes(session.id));
}
