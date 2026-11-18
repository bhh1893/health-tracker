import { lazy, Suspense } from "react";
import { Button } from "react-aria-components";
import { Link, Navigate, Route, Routes } from "react-router";

import { isSignupClosed, useMe } from "./auth/me";
import { CATALOGS } from "./catalog/catalogs";
import { PendingScreen } from "./auth/PendingScreen";
import { SignupClosedScreen } from "./auth/SignupClosedScreen";
import { ProblemAlert } from "./components/ProblemAlert";
import { ExerciseWindow } from "./exercise/ExerciseWindow";
import { MealsWindow } from "./meals/MealsWindow";
import { CatalogPage } from "./profile/CatalogPage";
import { ProfileScreen } from "./profile/ProfileScreen";
import { SearchScreen } from "./search/SearchScreen";
import { WindowLayout } from "./screens/WindowLayout";
import { AppShell } from "./shell/AppShell";
import { RedirectKeepingQuery } from "./shell/RedirectKeepingQuery";

// Loaded on first visit, not with the app: the chart library is larger than the rest
// of the bundle, and the daily logging screens never need it (ADR 0024).
const DashboardsScreen = lazy(() => import("./dashboards/DashboardsScreen"));

function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link className="text-teal-700 underline" to="/">
        Back to start
      </Link>
    </main>
  );
}

function Loading() {
  return (
    <p role="status" className="p-4 text-gray-500">
      Loading...
    </p>
  );
}

export function App() {
  // The page only loads with a session (ADR 0021), so the one open question is the
  // Role. Asked before any screen renders: a Pending person would otherwise see every
  // screen fail with 403. A 401 never reaches here; the API client reloads into
  // sign-in first.
  const me = useMe();

  if (me.data === undefined) {
    // An answer, not a failure: no "Try again", since the brake stays closed until
    // the Admin opens it. A reload asks again.
    if (isSignupClosed(me.error)) {
      return <SignupClosedScreen />;
    }
    if (me.isError) {
      return (
        <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
          <ProblemAlert error={me.error} />
          <Button
            className="rounded-xl bg-teal-700 px-4 py-3 text-base text-white data-[pressed]:bg-teal-900"
            onPress={() => void me.refetch()}
          >
            Try again
          </Button>
        </main>
      );
    }
    return <Loading />;
  }

  // Replaces the routes rather than redirecting, so the URL survives: a deep link
  // opened while Pending lands on the same Day once approved.
  if (me.data.role === "pending") {
    return (
      <PendingScreen
        email={me.data.email}
        checking={me.isFetching}
        error={me.error}
        onCheckAgain={() => void me.refetch()}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/exercise" replace />} />
      {/* Paths from before the bottom bar, kept forever (ADR 0031). */}
      <Route
        path="/search"
        element={<RedirectKeepingQuery to="/history/search" />}
      />
      <Route
        path="/dashboards"
        element={<RedirectKeepingQuery to="/history" />}
      />
      <Route element={<AppShell />}>
        {/* Add */}
        <Route element={<WindowLayout />}>
          <Route path="/exercise" element={<ExerciseWindow />} />
          <Route path="/meals" element={<MealsWindow />} />
        </Route>
        {/* History */}
        <Route
          path="/history"
          element={
            // Inside the shell, so the bar stays while the chart chunk loads.
            <Suspense fallback={<Loading />}>
              <DashboardsScreen />
            </Suspense>
          }
        />
        <Route path="/history/search" element={<SearchScreen />} />
        {/* Profile */}
        <Route path="/profile" element={<ProfileScreen />} />
        {CATALOGS.map((catalog) => (
          <Route
            key={catalog.key}
            path={catalog.page}
            // Keyed too, so moving between two Catalog pages never carries an
            // open sheet from one to the other.
            element={<CatalogPage key={catalog.key} catalog={catalog} />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
