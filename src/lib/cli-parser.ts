/**
 * Minimal CLI flag parsing utilities shared across commands.
 */

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Parse an enum-typed flag from args.
 * - Returns `defaultValue` if the flag is absent.
 * - Throws `CliError` if the flag is present but has no value (next token is another flag or end of args).
 * - Throws `CliError` if the value is not in `allowed`.
 */
export function parseEnumFlag<T extends string>(
  args: string[],
  flag: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const idx = args.indexOf(flag);
  if (idx === -1) return defaultValue;
  const val = args[idx + 1];
  if (val === undefined || val.startsWith("-")) {
    throw new CliError(
      `Missing value for ${flag}. Must be one of: ${allowed.join(", ")}`,
    );
  }
  if (!(allowed as readonly string[]).includes(val)) {
    throw new CliError(
      `Invalid value for ${flag}: "${val}". Must be one of: ${allowed.join(", ")}`,
    );
  }
  return val as T;
}

/**
 * Parse a string flag from args.
 * Returns the value after `--flag`, or `undefined` if absent or if next token is another flag.
 */
export function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (val === undefined || val.startsWith("-")) return undefined;
  return val;
}

/**
 * Returns true if the flag is present anywhere in args.
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
