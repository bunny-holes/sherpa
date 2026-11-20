import { invalidRequest } from "./errors.ts";

/** The value after `name`. A missing flag or value is an invalid request. */
export function value(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : undefined;
  if (found === undefined) throw invalidRequest();
  return found;
}

export function optionalValue(args: readonly string[], name: string): string | undefined {
  return args.includes(name) ? value(args, name) : undefined;
}

export function integer(args: readonly string[], name: string): number {
  const raw = value(args, name);
  if (!/^-?\d+$/.test(raw)) throw invalidRequest();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw invalidRequest();
  return parsed;
}

export function unsigned(args: readonly string[], name: string): bigint {
  const raw = value(args, name);
  if (!/^\d+$/.test(raw)) throw invalidRequest();
  const parsed = BigInt(raw);
  if (parsed > 18446744073709551615n) throw invalidRequest();
  return parsed;
}

export function requireConfirmation(args: readonly string[], expected: string): void {
  if (value(args, "--confirm") !== expected) throw invalidRequest();
}
