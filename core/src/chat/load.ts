/**
 * Loads the AI SDK and the four providers when a chat's first turn starts, so a core that serves
 * no chat keeps its idle memory (ADR-0012 "메모리와 크기"). The only module that imports
 * src/chat/sdk/; it reaches it with import() alone, and says so at debug the one time it does.
 */
import { log } from "../log.ts";

type TurnModule = typeof import("./sdk/turn.ts");

let loading: Promise<TurnModule> | undefined;

export function loadTurn(): Promise<TurnModule> {
  loading ??= (async () => {
    const started = Date.now();
    const turn = await import("./sdk/turn.ts");
    log.debug(`[core:chat:load] success ms=${Date.now() - started}`);
    return turn;
  })();
  return loading;
}
