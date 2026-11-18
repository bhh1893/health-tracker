import { useMe } from "../auth/me";
import { SignOutLink } from "../auth/SignOutLink";
import { avatarLetter, present } from "./identity";

// Profile's menu hub, P1 (ADR 0031): who is signed in at the top, Sign out at the
// bottom. The Catalogs and Settings sections arrive between them (ADR 0032).
export function ProfileScreen() {
  // A cache hit, not a request: App loaded /api/me before any route rendered.
  const me = useMe();
  const name = present(me.data?.name ?? null);
  const email = present(me.data?.email ?? null);
  const letter = avatarLetter(name, email);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 p-4">
      <h1 className="text-xl font-semibold">Profile</h1>

      <section aria-label="Signed in as" className="flex items-center gap-4">
        {/* Decorative: the name and email beside it say the same thing in words. */}
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-teal-700 text-2xl font-semibold text-white"
        >
          {letter ?? (
            // The same person glyph as the Profile tab.
            <svg
              viewBox="0 0 24 24"
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          )}
        </div>
        {/* A missing value is left out, never shown as a blank line. */}
        <div className="flex min-w-0 flex-col">
          {name !== null && (
            <p className="truncate text-lg font-semibold">{name}</p>
          )}
          {email !== null && <p className="truncate text-gray-600">{email}</p>}
        </div>
      </section>

      {/* Catalogs and Settings go here (ADR 0032). */}

      <SignOutLink className="py-2 text-base font-semibold text-red-700" />
    </main>
  );
}
