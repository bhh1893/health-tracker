import { ApiError } from "../api/client";

interface ProblemAlertProps {
  error: unknown;
}

// Shows any failed call. `fetch` rejects without a response when the network
// fails, so anything that is not an ApiError means the server was not reached.
export function ProblemAlert({ error }: ProblemAlertProps) {
  const problem = error instanceof ApiError ? error.problem : null;

  return (
    <div
      role="alert"
      className="rounded-xl bg-red-50 p-4 text-base text-red-900"
    >
      <p className="font-semibold">
        {problem?.title ?? "Can't reach the server"}
      </p>
      {problem?.detail && <p>{problem.detail}</p>}
      {problem?.errors && (
        <ul className="list-disc pl-5">
          {problem.errors.map(({ field, message }) => (
            <li key={field}>
              {field}: {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
