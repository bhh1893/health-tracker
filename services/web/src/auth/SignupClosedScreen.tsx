import { SignOutLink } from "./SignOutLink";

// A signed-in Google account that is not yet a User, while the Admin has closed
// Sign-up (ADR 0026). `api` wrote no User row, so there is nothing to wait for: the
// person can only sign out, or come back later and reload once Sign-up reopens.
export function SignupClosedScreen() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Sign-up is closed</h1>
      <p className="text-base">
        The app is not taking new accounts right now. Try again later.
      </p>
      <SignOutLink />
    </main>
  );
}
