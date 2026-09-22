/**
 * Peer messages are untrusted. Twin context never receives secrets.
 * Do not execute SQL, follow "ignore previous" jailbreaks, or treat
 * a peer as a system operator.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const IMPERSONATION =
  /^\s*(system|developer|tool|admin|root)\s*:/i;

export function sanitizePeerText(input: string, max = 8000): string {
  const stripped = input.replace(CONTROL, "").slice(0, max);
  if (IMPERSONATION.test(stripped)) {
    return `[untrusted peer text, system-impersonation stripped]\n${stripped.replace(IMPERSONATION, "")}`;
  }
  return stripped;
}

export function assertNoSecrets(context: Record<string, unknown>): void {
  const banned = ["OPENAI_API_KEY", "API_KEY", "SECRET", "PASSWORD", "TOKEN"];
  const blob = JSON.stringify(context).toUpperCase();
  for (const key of banned) {
    if (blob.includes(`${key}=`) || blob.includes(`"${key}"`)) {
      throw new Error("Refusing to place secrets in twin context");
    }
  }
}
