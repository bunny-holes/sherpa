/**
 * The model one turn talks to, built for that turn alone (ADR-0012 "제공자 면"): the four providers
 * with the key the turn carried and the turn's fetch, so a request reaches only the origin the
 * person chose and the key stays in that request's header.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, SystemModelMessage } from "ai";
import type { Fetch } from "../egress.ts";
import { INSTRUCTIONS } from "../instructions.ts";
import { ANTHROPIC_VERSION, type Provider } from "../providers.ts";

/** Who a turn talks to: the provider, the base URL its requests start with, the key and the model. */
export interface TurnTarget {
  provider: Provider;
  baseURL: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * A model object. A model id given as a string would go to the default provider, which the
 * egress leaves refusing every model (ADR-0012 "코드로 지키기" 3).
 */
export type TurnModel = Exclude<LanguageModel, string>;

/** The options a request carries for its provider, keyed by the provider's name. */
type ProviderOptions = NonNullable<SystemModelMessage["providerOptions"]>;

/** What a turn sends besides the conversation. */
export interface TurnProvider {
  model: TurnModel;
  instructions: SystemModelMessage;
  providerOptions: ProviderOptions;
}

// The instructions are the same every turn, so Anthropic may cache them, and the tools before them
// with them: a cached prefix runs tools, system, then messages. The other providers read no
// `anthropic` options (ADR-0012 "비용과 모델 선택").
const instructions: SystemModelMessage = {
  role: "system",
  content: INSTRUCTIONS,
  providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
};

export function turnProvider(target: TurnTarget, fetch: Fetch): TurnProvider {
  const { baseURL, apiKey, model } = target;
  switch (target.provider) {
    case "anthropic":
      // The SDK names 2023-06-01; a header given here replaces it. Version 2026-10-21 refuses
      // temperature, top_p and top_k, which a turn never sets (ADR-0012 "Anthropic API 판").
      return {
        model: createAnthropic({
          apiKey,
          baseURL,
          fetch,
          headers: { "anthropic-version": ANTHROPIC_VERSION },
        }).languageModel(model),
        instructions,
        // Automatic caching, a top-level `cache_control`: its breakpoint moves to the last block
        // as the conversation grows, so each step reads the conversation before it from the
        // cache. Both breakpoints keep the default 5 minutes.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      };
    case "openai":
      // The Responses API without storing the response. For a reasoning model the SDK then adds
      // `include: ["reasoning.encrypted_content"]`, a value OpenAI keeps only for compatibility:
      // an exception to decision 7 the owner accepted (2026-11-22, ADR-0012).
      return {
        model: createOpenAI({ apiKey, baseURL, fetch }).responses(model),
        instructions,
        providerOptions: { openai: { store: false } },
      };
    case "google":
      // The Interactions API, which stores an interaction unless told not to (ADR-0012 결정 7).
      return {
        model: createGoogle({ apiKey, baseURL, fetch }).interactions(model),
        instructions,
        providerOptions: { google: { store: false } },
      };
    case "openai-compatible":
      // `includeUsage` asks for the token counts of a streamed answer (`stream_options`).
      return {
        model: createOpenAICompatible({
          name: "openai-compatible",
          baseURL,
          apiKey,
          fetch,
          includeUsage: true,
        }).chatModel(model),
        instructions,
        providerOptions: {},
      };
  }
}
