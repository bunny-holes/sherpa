/**
 * Loads the AI SDK and the four providers when a chat's first turn starts, so a core that serves
 * no chat keeps its idle memory (ADR-0012 "메모리와 크기"). The only module that imports
 * src/chat/sdk/; it reaches it with import() alone.
 */
export function loadTurn(): Promise<typeof import("./sdk/turn.ts")> {
  return import("./sdk/turn.ts");
}
