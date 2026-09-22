export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: "owner" | "member";
}

export interface SessionOrg {
  id: string;
  name: string;
  plan: "free" | "pro";
}

const KEY = "twinmeet_session";

export function getStoredSessionId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeSessionId(id: string): void {
  localStorage.setItem(KEY, id);
}

export function clearStoredSession(): void {
  localStorage.removeItem(KEY);
}
