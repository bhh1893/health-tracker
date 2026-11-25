export interface Stat {
  label: string;
  value: string;
  // A second line under the value, such as the Day a record was set.
  note?: string | undefined;
}

// The headline numbers under a chart. A list, so a screen reader reads each label
// with its value.
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {stats.map(({ label, value, note }) => (
        <div key={label} className="rounded-xl bg-inset px-3 py-2">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="text-lg font-semibold">{value}</dd>
          {note !== undefined && <dd className="text-sm text-muted">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}
