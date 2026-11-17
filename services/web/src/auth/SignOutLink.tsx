// A plain link, not a router Link: sign-out is served by the auth-proxy sidecar, so
// the browser must really go there. It clears the session cookie and returns to /,
// which then shows the Sign-in page.
export function SignOutLink() {
  return (
    <a
      className="text-center text-base text-teal-700 underline"
      href="/oauth2/sign_out"
    >
      Sign out
    </a>
  );
}
