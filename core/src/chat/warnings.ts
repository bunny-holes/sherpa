/**
 * Where the AI SDK's warnings go (ADR-0012 "제공자 면"). The SDK hands the warnings of a call to
 * `globalThis.AI_SDK_LOG_WARNINGS` when it is a function, and otherwise prints them itself with
 * `process.emitWarning` or `console.warn`, their details and messages included (`ai` 7.0.179
 * `src/logger/log-warnings.ts`). `installWarningLog` leaves that global a function that writes one
 * Sherpa line per warning, for good.
 */
import type { LogWarningsFunction, Warning } from "ai";
import { log } from "../log.ts";

/** What a warning is about: the feature or setting it names, never its details or its message. */
function subject(warning: Warning): string | undefined {
  switch (warning.type) {
    case "unsupported":
    case "compatibility":
      return warning.feature;
    case "deprecated":
      return warning.setting;
    default:
      return undefined;
  }
}

/**
 * A value as one log field: word characters, `.`, `:`, `/` and `-` kept, anything else `_`, at
 * most 64 characters, `none` when empty. A feature can name a tool or an option in prose.
 */
function field(value: unknown): string {
  if (typeof value !== "string" || value === "") return "none";
  return value.replace(/[^\w.:/-]/g, "_").slice(0, 64);
}

const logWarnings: LogWarningsFunction = ({ warnings, provider }) => {
  for (const warning of warnings) {
    log.warn(
      `[core:chat:sdk-warning] type=${field(warning.type)} subject=${field(subject(warning))} provider=${field(provider)}`,
    );
  }
};

/**
 * Leaves `scope.AI_SDK_LOG_WARNINGS` the function above for good: it can be neither assigned nor
 * redefined as anything else. The core's entry point calls it once, before any command runs.
 */
export function installWarningLog(scope: { AI_SDK_LOG_WARNINGS?: unknown } = globalThis): void {
  Object.defineProperty(scope, "AI_SDK_LOG_WARNINGS", {
    value: logWarnings,
    enumerable: true,
    writable: false,
    configurable: false,
  });
}
