/**
 * The four chat providers (ADR-0012 결정 2, "제공자 면") and how the core lists the models of each
 * (app-connection-v1 §7.11, ADR-0012 "비용과 모델 선택"). Sherpa fixes the base URL of the first
 * three; an OpenAI-compatible server is wherever the person's base URL says.
 */
import { z } from "zod";

/** The providers whose origin Sherpa fixes, so a `list_models` for them carries no base URL. */
export const FIXED_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type FixedProvider = (typeof FIXED_PROVIDERS)[number];
export type Provider = FixedProvider | "openai-compatible";

export const FIXED_BASE_URLS: Readonly<Record<FixedProvider, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

/** The Anthropic API version the core names: the latest, as Anthropic recommends (ADR-0012). */
export const ANTHROPIC_VERSION = "2026-10-21";

/** One model of a list page before the core checks its id; `keep` is the provider's own filter. */
export interface ListedModel {
  id: unknown;
  keep: boolean;
}

/** One page of a model list, and the cursor of the next page or `null` on the last. */
export interface ModelPage {
  models: ListedModel[];
  next: string | null;
}

/** How one provider lists its models. */
export interface ModelLister {
  /** The URL of the page after `cursor`, or of the first page when it is `null`. */
  url(base: string, cursor: string | null): string;
  /** The request's headers. The key, when there is one, goes only here, never into the URL. */
  headers(apiKey: string | undefined): Record<string, string>;
  /** The page a response body holds, or `null` when the body has another shape. */
  page(body: unknown): ModelPage | null;
}

function pageURL(base: string, query: Record<string, string | null>): string {
  const url = new URL(`${base}/models`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== null) url.searchParams.set(name, value);
  }
  return url.href;
}

/** A header that carries the key, or none when there is no key. */
function keyHeader(name: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [name]: value };
}

// `GET /v1/models` (docs: platform.claude.com "List Models"): `limit` up to 1000 and `after_id`
// page on, and a model's `lifecycle` is `active` unless it says otherwise.
const anthropicPage = z.object({
  data: z.array(z.object({ id: z.unknown().optional(), lifecycle: z.unknown().optional() })),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});

// `GET /v1/models` (docs: developers.openai.com "List models") in one page. An OpenAI-compatible
// server that has the endpoint answers the same shape.
const openAIPage = z.object({ data: z.array(z.object({ id: z.unknown().optional() })) });

// `GET /v1beta/models` (docs: aistudio.google.com "Models"): `pageSize` up to 1000 and `pageToken`
// page on, and a model's `name` is `models/<id>`.
const googlePage = z.object({
  models: z.array(z.object({ name: z.unknown().optional() })).optional(),
  nextPageToken: z.string().optional(),
});

const GOOGLE_NAME_PREFIX = "models/";

const openAILister: ModelLister = {
  url: (base) => pageURL(base, {}),
  headers: (apiKey) =>
    keyHeader("authorization", apiKey === undefined ? undefined : `Bearer ${apiKey}`),
  page(body) {
    const page = openAIPage.safeParse(body);
    if (!page.success) return null;
    // Decision 7 does not reach the ids: no guessing which model chats (ADR-0012).
    return { models: page.data.data.map(({ id }) => ({ id, keep: true })), next: null };
  },
};

export const LISTERS: Readonly<Record<Provider, ModelLister>> = {
  anthropic: {
    url: (base, cursor) => pageURL(base, { limit: "1000", after_id: cursor }),
    headers: (apiKey) => ({
      ...keyHeader("x-api-key", apiKey),
      "anthropic-version": ANTHROPIC_VERSION,
    }),
    page(body) {
      const page = anthropicPage.safeParse(body);
      if (!page.success) return null;
      const { data, has_more: more, last_id: last } = page.data;
      if (more && !last) return null;
      return {
        // Decision 7: active models only, read from the answer because the docs do not say how
        // the `lifecycle` array goes into a URL.
        models: data.map(({ id, lifecycle }) => ({
          id,
          keep: lifecycle === undefined || lifecycle === "active",
        })),
        next: more ? last : null,
      };
    },
  },
  openai: openAILister,
  google: {
    url: (base, cursor) => pageURL(base, { pageSize: "1000", pageToken: cursor }),
    // Never `?key=` as the docs' examples do: the key stays out of every URL (ADR-0012).
    headers: (apiKey) => keyHeader("x-goog-api-key", apiKey),
    page(body) {
      const page = googlePage.safeParse(body);
      if (!page.success) return null;
      return {
        models: (page.data.models ?? []).map(({ name }) => ({
          id:
            typeof name === "string" && name.startsWith(GOOGLE_NAME_PREFIX)
              ? name.slice(GOOGLE_NAME_PREFIX.length)
              : undefined,
          keep: true,
        })),
        // An empty token ends the list as a missing one does.
        next: page.data.nextPageToken || null,
      };
    },
  },
  "openai-compatible": openAILister,
};
