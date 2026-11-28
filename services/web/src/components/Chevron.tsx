// The open/closed mark on a disclosure row. Points down when closed and up when
// open: react-aria's Disclosure carries data-expanded, and `group` on it lets this
// child read it, so the Disclosure must have the `group` class. The color is the
// row's to pick: faint on a card, on-restaurant on a pink row.
export function Chevron({ className = "text-faint" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-5 shrink-0 transition-transform group-data-expanded:rotate-180 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
