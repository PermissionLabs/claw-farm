/**
 * Default USER.template.md — per-instance user profile template.
 * Placeholders like {{KEY}} are filled at spawn time with --context k=v pairs.
 * OpenClaw auto-loads USER.md into the system prompt.
 */
export function userTemplateContent(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  return `# ${safeName} — User Profile

> OpenClaw automatically loads this file into the system prompt.
> Customize it with user-specific information.

## User Info
- User ID: {{USER_ID}}

## Notes
> You can inject additional info at spawn time with --context key=value.
`;
}

/**
 * Fill a USER.template.md with provided key-value context.
 * Unfilled placeholders are replaced with [not provided].
 */
export function fillUserTemplate(
  template: string,
  userId: string,
  context?: Record<string, string>,
): string {
  let result = template.replaceAll("{{USER_ID}}", userId);
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
  }
  // Replace any remaining unfilled placeholders
  result = result.replace(/\{\{[A-Z_]+\}\}/g, "[not provided]");
  return result;
}
