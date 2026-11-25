// A plain link, not a router Link: sign-out is served by the auth-proxy sidecar, so
// the browser must really go there. It clears the session cookie and returns to /,
// which then shows the Sign-in page. It ends the app session only: the Google session
// stays, so signing in again on this device skips Google's password (ADR 0021).
//
// The look is the caller's: a quiet link on the Pending screen, red on Profile.
export function SignOutLink({
  className = "text-center text-base text-action underline",
}: {
  className?: string;
}) {
  return (
    <a className={className} href="/oauth2/sign_out">
      Sign out
    </a>
  );
}
