import { Button } from "react-aria-components";

import type { CatalogRef } from "./catalogs";
import type { NameClash as Clash } from "./nameClash";

interface NameClashProps {
  clash: Clash;
  // The name the User tried to save.
  name: string;
  pending: boolean;
  onSaveAnyway: () => void;
  // Opens a matching item in place of this sheet. Left out where nothing can be
  // opened, and the names are then plain text.
  onOpen?: ((item: CatalogRef) => void) | undefined;
}

// ADR 0032 reusing ADR 0008's flow on a sheet: an exact match blocks the save and
// points at the item that has the name; a close match lists the similar names and
// lets the User save anyway. role="alert", so a screen reader hears why Save did
// nothing.
export function NameClash({
  clash,
  name,
  pending,
  onSaveAnyway,
  onOpen,
}: NameClashProps) {
  const matches = clash.kind === "exact" ? [clash.existing] : clash.similar;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4"
    >
      <p className="font-semibold">
        {clash.kind === "exact"
          ? `"${clash.existing.name}" already exists${clash.existing.archived ? ", archived" : ""}.`
          : "Similar names already exist:"}
      </p>
      <ul className="flex flex-col gap-2">
        {matches.map((match) => (
          <li key={match.id}>
            {onOpen ? (
              <Button
                className="w-full rounded-xl border border-gray-300 bg-white p-3 text-left text-base data-pressed:bg-gray-100"
                onPress={() => {
                  onOpen(match);
                }}
              >
                Open {match.name}
                {match.archived && " (archived)"}
              </Button>
            ) : (
              <span>
                {match.name}
                {match.archived && " (archived)"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {clash.kind === "near" && (
        <Button
          className="rounded-xl border border-gray-300 bg-white p-3 text-base"
          isDisabled={pending}
          onPress={onSaveAnyway}
        >
          Save "{name}" anyway
        </Button>
      )}
    </div>
  );
}
