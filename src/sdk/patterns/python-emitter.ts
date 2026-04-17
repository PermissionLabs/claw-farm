// Serializes TS SecretPatternGroup[] into Python re.compile() literals.
// Used by the api-proxy template to keep Python and TS patterns in sync.

import type { SecretPatternGroup } from "../types.ts";

/** Map JS regex flags to Python re.FLAG names. */
function toPythonFlags(flags: string): string {
  const mapped: string[] = [];
  if (flags.includes("i")) mapped.push("re.IGNORECASE");
  if (flags.includes("m")) mapped.push("re.MULTILINE");
  if (flags.includes("s")) mapped.push("re.DOTALL");
  // 'g' has no Python equivalent (findall/sub handle it implicitly)
  return mapped.length > 0 ? `, ${mapped.join(" | ")}` : "";
}

/**
 * Escape a JS regex source string so it is safe inside a Python raw string r"...".
 * The only character that breaks a raw string is a trailing backslash or an
 * unescaped double-quote (we wrap in r"...").
 */
function escapeForPythonRaw(source: string): string {
  // Replace literal double-quotes with escaped version
  return source.replace(/"/g, '\\"');
}

/**
 * Emit a Python list literal body (lines between the outer `[` and `]`)
 * for use inside SECRET_PATTERNS = [...].
 *
 * Each entry is a tuple: (re.compile(r"...", flags), "NAME")
 */
export function emitPythonSecretPatterns(groups: SecretPatternGroup[]): string {
  const lines: string[] = [];
  for (const group of groups) {
    for (const p of group.patterns) {
      const src = escapeForPythonRaw(p.regex.source);
      const flags = toPythonFlags(p.regex.flags);
      lines.push(`    (re.compile(r"${src}"${flags}), "${p.name}"),`);
    }
  }
  return lines.join("\n");
}
