// The one module that imports src/chat/sdk/, with import() when the first turn starts; it takes
// only the AI SDK's types itself.
import type { LanguageModel } from "ai";
import { streamText } from "ai"; // expect: eslint(no-restricted-imports)

const turn = await import("./sdk/turn.ts");
const tools = await import("./sdk/tools.ts");
const sdk = await import("ai"); // expect: eslint(no-restricted-imports)
const openai = await import("@ai-sdk/openai"); // expect: eslint(no-restricted-imports)

export type { LanguageModel };
export { streamText, turn, tools, sdk, openai };
