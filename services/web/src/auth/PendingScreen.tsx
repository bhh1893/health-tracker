import { Button } from "react-aria-components";

import { ProblemAlert } from "../components/ProblemAlert";
import { SignOutLink } from "./SignOutLink";

interface PendingScreenProps {
  checking: boolean;
  error: unknown;
  onCheckAgain: () => void;
}

// A signed-in person with no Role yet (ADR 0026). `api` refuses them everything but
// GET /api/me, so this screen is all the app shows. No polling: approval is a person
// running a command, so it can take days, and the person checks when they want to.
export function PendingScreen({
  checking,
  error,
  onCheckAgain,
}: PendingScreenProps) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Waiting for approval</h1>
      <p className="text-base">
        You are signed in. The owner has to approve your account before you can
        use the app.
      </p>
      {error !== null && <ProblemAlert error={error} />}
      <Button
        className="rounded-xl bg-teal-700 px-4 py-3 text-base text-white data-[disabled]:bg-gray-400 data-[pressed]:bg-teal-900"
        isDisabled={checking}
        onPress={onCheckAgain}
      >
        {checking ? "Checking..." : "Check again"}
      </Button>
      <SignOutLink />
    </main>
  );
}
