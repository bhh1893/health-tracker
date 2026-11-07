import { Link } from "react-router";

// Empty on purpose: #68 replaces this with the real screen.

export function SearchScreen() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <Link className="text-teal-700 underline" to="/exercise">
        Back
      </Link>
      <h1 className="text-xl font-semibold">Search</h1>
    </main>
  );
}
