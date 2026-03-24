/**
 * Default CONTEXT.template.md — per-instance context template.
 * Placeholders like {{KEY}} are filled at spawn time with --context k=v pairs.
 */
export function contextTemplateContent(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  return `# ${safeName} — Context

> This file contains fixed context for this instance.
> The agent automatically loads this information at the start of every conversation.

## User Info
- User ID: {{USER_ID}}

## Notes
> You can inject additional info at spawn time with --context key=value.
`;
}

/**
 * Fill a CONTEXT.template.md with provided key-value context.
 * Unfilled placeholders are replaced with [not provided].
 */
export function fillContext(
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
