---
status: accepted
---

# App shell and bottom bar: History | Add | Profile, with old URLs kept as redirects

`web` moves from one Exercise | Meals window with Search and Dashboards icons in its header to a floating bottom bar with three tabs: **History** (Dashboards and Search), **Add** (the Exercise | Meals window, unchanged apart from losing the header icons) and **Profile**. Every URL that worked before still opens the same screen, because bookmarks, the home-screen shortcut and Search's Day links are a contract. Decided in [Bottom bar navigation and the History tab](https://github.com/bhh1893/health-tracker/issues/219), on the map [Health Tracker v1: bottom navigation and Profile](https://github.com/bhh1893/health-tracker/issues/222). It amends ADR 0008, ADR 0013 and ADR 0024.

**Amended by ADR 0033:** History's layout (H2 with a search box linking to Search) is replaced by Recent Days with a Meals filter and a required Exercise pick; `/history/search` becomes a redirect.

## Shape

- **Routes.** Add keeps `/exercise` and `/meals`; `/` still lands on `/exercise`. History is `/history` (the dashboard) and `/history/search`. Profile is `/profile` and its sub-pages.
- **Redirects, kept forever.** `/search` goes to `/history/search` and `/dashboards` to `/history`, query string included.
- **Route vs label.** The route stays `/history` whatever the tab is called; the label is one constant. "History" is provisional, so a rename is a one-line change, and moving the URL would be a separate decision with its own redirect.
- **One shell.** An `AppShell` layout route draws the bar and an `<Outlet />` around every screen of an approved User, Not Found included. The Pending screen still replaces the whole route tree (ADR 0021), so it has no bar; the Sign-in page belongs to oauth2-proxy and is outside the app.
- **Bar.** Mockup A: a white floating pill, three tabs with icon and label, the active tab tinted teal. Fixed above the iOS home indicator (`env(safe-area-inset-bottom)`), with page content padded so the last card never hides behind it. Tabs are links with `aria-current="page"`, not buttons. Sheets and dialogs cover it; no keyboard handling unless a phone shows the bar hiding an input.
- **Per-tab memory.** Each tab remembers the last path it showed, in memory only, so a fresh launch opens on today. Tapping the active tab again resets it to its root (Add to `/exercise`, today).
- **History ignores Add's Day.** Ranges on History count back from today; `?day=` does not cross tabs.
- **No more BackState.** The bar replaces the header round trip, so `BackState`/`backTarget` go. Search's Back link goes to `/history`. Search's Day links still open Add at that Day; the phone's back gesture returns to Search.
- **History layout (mockup H2).** The dashboard, with a box styled as a search input on top. It is a link to `/history/search`, which focuses the real search field on arrival. The shell draws the box, so it shows before the chart chunk loads.
- **Code splitting holds.** The dashboard chunk still loads on the first History visit; Add never pays for the chart library (ADR 0024).

## Considered Options

- **Drop the old paths.** Rejected: two redirect lines keep every saved link working.
- **A real search input on the dashboard, searching inline.** Rejected: Search and Dashboards each keep their whole state in their own URL (ADR 0013, ADR 0024); merging them would mix the two.
- **Carry `?day=` into History.** Rejected: History answers "how is it trending?" relative to today, and coupling it to Add's Day would make the same tap show different ranges.
- **Persist tab memory in storage.** Rejected: it would reopen yesterday's Day the next morning.

## Consequences

- The `auth-check` query in `WindowLayout` predates Google sign-in (it guards a "wrong secret" screen that no longer exists) and is removed with the restructure; `useMe` already fails at load.
- `/profile` ships as a placeholder until the Profile tickets land.

## Amendment: Add opens on Meals

Changed 2026-11-18, to match History's Meals | Exercise order (ADR 0033). Add's switch reads Meals | Exercise, `/` lands on `/meals`, and Add's root, where a second tap resets it, is `/meals`. The `/exercise` route is unchanged.
