import { useSyncExternalStore } from "react";
import { Link, Navigate, Route, Routes } from "react-router";

import { getAuthState, subscribe } from "./auth/token";
import { EnterSecret } from "./screens/EnterSecret";
import {
  ExerciseWindow,
  MealsWindow,
  SearchScreen,
} from "./screens/placeholders";
import { WindowLayout } from "./screens/WindowLayout";

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

export function App() {
  const { token, rejected } = useSyncExternalStore(subscribe, getAuthState);

  // Replaces the routes rather than redirecting, so the URL survives: a deep link
  // opened without a secret lands on the same Day once one is entered.
  if (token === null) {
    return <EnterSecret rejected={rejected} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/exercise" replace />} />
      <Route element={<WindowLayout />}>
        <Route path="/exercise" element={<ExerciseWindow />} />
        <Route path="/meals" element={<MealsWindow />} />
      </Route>
      <Route path="/search" element={<SearchScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
