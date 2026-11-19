import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

interface SegmentsProps<T extends string> {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  // A small inline switch, such as a chart's chart | table, instead of a full row.
  compact?: boolean;
}

// A full-width segmented control where exactly one segment is on, styled like Add's
// Exercise | Meals switch (WindowLayout). React Aria's ToggleButtonGroup gives each
// segment a pressed state a screen reader announces, and arrow keys move between them.
export function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
  compact = false,
}: SegmentsProps<T>) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const picked = options.find(({ id }) => keys.has(id));
        if (picked) {
          onChange(picked.id);
        }
      }}
      className={
        compact
          ? "inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5"
          : "flex gap-1 rounded-xl bg-gray-100 p-1"
      }
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={`${
            compact
              ? "rounded-md px-2.5 py-1 text-sm"
              : "flex-1 rounded-lg px-4 py-2 text-base"
          } text-gray-600 data-selected:bg-white data-selected:font-semibold data-selected:text-gray-900 data-selected:shadow-sm`}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
