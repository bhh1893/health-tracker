import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, Route, Routes } from "react-router";

import { uuidv7 } from "./lib/uuidv7";

function Hello() {
  const [id, setId] = useState<string | null>(null);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Health Tracker</h1>
      <Button
        className="rounded-xl bg-teal-700 px-4 py-3 text-base text-white data-[pressed]:bg-teal-900"
        onPress={() => {
          setId(uuidv7());
        }}
      >
        Generate ID
      </Button>
      {id && <code className="text-sm break-all">{id}</code>}
    </main>
  );
}

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
  return (
    <Routes>
      <Route path="/" element={<Hello />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
