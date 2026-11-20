/**
 * A failure with a Sherpa-owned stable code. `remedy` is fixed Sherpa text that tells
 * the caller how to recover (an install or permission step); it never carries
 * provider text, personal data or secrets.
 */
export class SherpaError extends Error {
  constructor(
    readonly code: string,
    readonly options: { remedy?: string; mayHaveApplied?: boolean } = {},
  ) {
    super(code);
    this.name = "SherpaError";
  }

  get remedy(): string | undefined {
    return this.options.remedy;
  }

  /** True only when a mutation command already held its input and the outcome is unknown. */
  get mayHaveApplied(): boolean {
    return this.options.mayHaveApplied === true;
  }
}

/** Codes kept from the 0.7 CLI so callers that match on them keep working. */
export const codes = {
  invalidRequest: "invalidRequest",
  executableUnavailable: "executableUnavailable",
  outputTooLarge: "outputTooLarge",
  failed: "failed",
  timedOut: "timedOut",
  uncertain: "uncertain",
  internal: "sherpa.internal_failure",
} as const;

export const invalidRequest = () => new SherpaError(codes.invalidRequest);
