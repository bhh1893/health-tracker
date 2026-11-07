import { useState } from "react";
import { Button } from "react-aria-components";

import { BottomSheet } from "../components/BottomSheet";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { useDeleteSet } from "./queries";
import { formatSet, type Session } from "./sessions";

interface DeleteSessionSheetProps {
  day: string;
  session: Session;
  onClose: () => void;
}

// There is no Session resource, so this sends one DELETE per Set (ADR 0008). The
// list is local state because optimistic removal empties the feed's copy at once.
export function DeleteSessionSheet({
  day,
  session,
  onClose,
}: DeleteSessionSheetProps) {
  const [remaining, setRemaining] = useState(session.sets);
  const [failure, setFailure] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteSet = useDeleteSet();

  async function confirm() {
    setDeleting(true);
    setFailure(null);
    const results = await Promise.allSettled(
      remaining.map((set) => deleteSet.mutateAsync(set)),
    );
    setDeleting(false);

    const failed = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ set: remaining[index], reason: result.reason as unknown }]
        : [],
    );
    if (failed.length === 0) {
      onClose();
      return;
    }
    // Stays open with what is left. Retrying is safe: DELETE is idempotent.
    setRemaining(failed.flatMap(({ set }) => (set ? [set] : [])));
    setFailure(failed[0]?.reason);
  }

  return (
    <BottomSheet
      title={`Delete ${session.exercise.name} on ${formatDay(day)}?`}
      onClose={onClose}
    >
      <ol className="flex flex-col text-base">
        {remaining.map((set) => (
          <li key={set.id} className="border-b border-gray-100 py-2">
            {formatSet(set)}
          </li>
        ))}
      </ol>
      {failure !== null && <ProblemAlert error={failure} />}
      <div className="grid grid-cols-2 gap-3">
        <Button
          className="rounded-xl p-3 text-base text-gray-600"
          onPress={onClose}
        >
          Cancel
        </Button>
        <Button
          className="rounded-xl bg-red-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
          isDisabled={deleting}
          onPress={() => {
            void confirm();
          }}
        >
          Delete
        </Button>
      </div>
    </BottomSheet>
  );
}
