/**
 * The error codes of a chat channel (app-connection-v1 §7.11) and how a failed provider request
 * reads as one. An HTTP status reads as the AI SDK reads it, so a model list and a turn are
 * offered again alike (`@ai-sdk/provider` 4.0.39 `APICallError.isRetryable`).
 */
import { EgressDeniedError } from "./egress.ts";

export type ChatErrorCode =
  | "invalid_message"
  | "busy"
  | "egress_denied"
  | "network"
  | "timeout"
  | "provider_certificate"
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_invalid_response"
  | "internal";

const RETRYABLE: ReadonlySet<ChatErrorCode> = new Set<ChatErrorCode>([
  "network",
  "timeout",
  "provider_rate_limited",
  "provider_unavailable",
]);

/** Whether the same request may succeed later, so the app offers it again. */
export function retryable(code: ChatErrorCode): boolean {
  return RETRYABLE.has(code);
}

/** A provider request that ended without an answer the app can use; `status` is the HTTP one. */
export class ChatFailure extends Error {
  constructor(
    readonly code: ChatErrorCode,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "ChatFailure";
  }
}

function statusCode(status: number): ChatErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return "provider_rate_limited";
  if (status === 408 || status === 409 || status >= 500) return "provider_unavailable";
  return status >= 400 ? "provider_rejected" : "provider_invalid_response";
}

/** A response that is not 2xx. A redirect never gets here: the egress refuses it. */
export function responseFailure(status: number): ChatFailure {
  return new ChatFailure(statusCode(status), status);
}

/**
 * The verify errors of a server certificate under the OpenSSL names Node gives them (docs:
 * nodejs.org "OpenSSL error codes", out-of-memory left out), which Bun 1.4.5's `fetch` puts in
 * the `code` of its `TypeError`, and Node's `ERR_TLS_CERT_ALTNAME_INVALID` for a certificate
 * that does not name the host.
 */
const CERTIFICATE_CODES: ReadonlySet<string> = new Set([
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "CRL_NOT_YET_VALID",
  "CRL_HAS_EXPIRED",
  "CERT_REVOKED",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_CHAIN_TOO_LONG",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
  "INVALID_CA",
  "PATH_LENGTH_EXCEEDED",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "INVALID_PURPOSE",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "CRL_SIGNATURE_FAILURE",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "ERROR_IN_CRL_LAST_UPDATE_FIELD",
  "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
]);

/**
 * A request the egress refused, one that got no response, or one whose body broke off: Bun's
 * `fetch` rejects a connection that failed with a `TypeError` and a one-word `code`.
 */
export function transportFailure(error: unknown): ChatFailure {
  if (error instanceof EgressDeniedError) return new ChatFailure("egress_denied");
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const certificate = typeof code === "string" && CERTIFICATE_CODES.has(code);
  return new ChatFailure(certificate ? "provider_certificate" : "network");
}
