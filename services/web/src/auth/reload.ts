// A 401 means the session cookie is missing or past its 30 days (ADR 0021). The page
// cannot sign in by itself: the cookie is HttpOnly and the sign-in flow runs in the
// auth-proxy sidecar. Reloading the same URL sends the browser there, and the Sign-in
// page brings the person back to this path afterwards. Unsaved form input is lost,
// which ADR 0021 accepts because expiry comes once a month.
//
// Its own module so tests can replace it: jsdom does not implement navigation.
export function reloadIntoSignIn() {
  window.location.reload();
}
