// The one place that knows where the shared secret lives (ADR 0010).
//
// localStorage survives app restarts, which a home-screen app needs, but any
// script on this page can read it. That is the accepted v1 risk: the page loads
// no third-party scripts, and over plain HTTP the token already crosses the
// Wi-Fi in cleartext on every request.
const STORAGE_KEY = "health-tracker.api-token";

export interface AuthState {
  token: string | null;
  // True when the server refused the token, so the secret screen can say why it
  // came back instead of looking like a first visit.
  rejected: boolean;
}

let state: AuthState = {
  token: localStorage.getItem(STORAGE_KEY),
  rejected: false,
};
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

// `subscribe` and `getAuthState` are the pair useSyncExternalStore needs, which
// lets React re-render when code outside React (the API middleware) changes this.
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthState() {
  return state;
}

export function saveToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token);
  setState({ token, rejected: false });
}

export function rejectToken(token: string) {
  // A slow 401 for an old token must not throw away a newer one.
  if (token !== state.token) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  setState({ token: null, rejected: true });
}

export function forgetToken() {
  localStorage.removeItem(STORAGE_KEY);
  setState({ token: null, rejected: false });
}
