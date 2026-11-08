import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

interface SegmentsProps<T extends string> {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

// A row of chips where exactly one is on. React Aria's ToggleButtonGroup gives each
// chip a pressed state a screen reader announces, and arrow keys move between them.
export function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
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
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className="rounded-full border border-gray-300 px-3 py-1 text-base data-selected:border-teal-700 data-selected:bg-teal-700 data-selected:text-white"
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
