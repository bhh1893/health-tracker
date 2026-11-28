import { Link } from "react-router";

import { useMe } from "../auth/me";
import { SignOutLink } from "../auth/SignOutLink";
import { CATALOGS } from "../catalog/catalogs";
import { avatarLetter, present } from "./identity";
import { RestaurantDaySetting } from "./RestaurantDaySetting";

// Profile's menu hub, P1 (ADR 0031): who is signed in at the top, then the Catalogs
// (ADR 0032), then Settings (ADR 0032), Sign out at the bottom.
export function ProfileScreen() {
  // A cache hit, not a request: App loaded /api/me before any route rendered.
  const me = useMe();
  const name = present(me.data?.name ?? null);
  const email = present(me.data?.email ?? null);
  const letter = avatarLetter(name, email);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 p-4">
      <h1 className="text-center text-xl font-semibold text-action-ink">
        Profile
      </h1>

      <section aria-label="Signed in as" className="flex items-center gap-4">
        {/* Decorative: the name and email beside it say the same thing in words. */}
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-action text-2xl font-semibold text-on-fill"
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
          {email !== null && <p className="truncate text-muted">{email}</p>}
        </div>
      </section>

      {/* "Catalogs", the glossary's word for what logging builds (ADR 0032). */}
      <nav aria-labelledby="catalogs-heading" className="flex flex-col gap-2">
        <h2
          id="catalogs-heading"
          className="text-sm font-semibold tracking-wide text-faint uppercase"
        >
          Catalogs
        </h2>
        <ul className="flex flex-col divide-y divide-edge rounded-xl border border-edge bg-card">
          {CATALOGS.map((catalog) => (
            <li key={catalog.key}>
              <Link
                to={catalog.page}
                className="flex items-center justify-between p-3 text-base"
              >
                {catalog.plural}
                <span aria-hidden="true" className="text-faint">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-labelledby="settings-heading"
        className="flex flex-col gap-2"
      >
        <h2
          id="settings-heading"
          className="text-sm font-semibold tracking-wide text-faint uppercase"
        >
          Settings
        </h2>
        {me.data && (
          <RestaurantDaySetting
            // Remounted when the saved value changes, so the field follows it.
            key={me.data.restaurant_day_kcal}
            saved={me.data.restaurant_day_kcal}
          />
        )}
      </section>

      <SignOutLink className="py-2 text-base font-semibold text-danger" />
    </main>
  );
}
