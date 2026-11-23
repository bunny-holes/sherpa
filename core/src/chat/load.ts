/**
 * Loads the AI SDK and the four providers when a chat's first turn starts or its `resume` is
 * checked, so a core that serves no chat keeps its idle memory (ADR-0012 "메모리와 크기"). The only
 * module that imports src/chat/sdk/; it reaches it with import() alone, and says so at debug the
 * one time it does.
 */
import { log } from "../log.ts";

/** The turn's model call, and what a chat's state needs of the SDK. */
export interface ChatModules {
  turn: typeof import("./sdk/turn.ts");
  state: typeof import("./sdk/state.ts");
}

let loading: Promise<ChatModules> | undefined;

export function loadChat(): Promise<ChatModules> {
  loading ??= (async () => {
    const started = Date.now();
    const [turn, state] = await Promise.all([import("./sdk/turn.ts"), import("./sdk/state.ts")]);
    log.debug(`[core:chat:load] success ms=${Date.now() - started}`);
    return { turn, state };
  })();
  return loading;
}
