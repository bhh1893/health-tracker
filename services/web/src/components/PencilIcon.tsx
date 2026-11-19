// The pencil on a Meal or Session card's Edit button. The button carries the label
// ("Edit Meal 1", "Edit Bench Press"), so the icon is hidden from screen readers.
export function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4M13.5 6.5l4 4" />
    </svg>
  );
}
