export interface Stat {
  label: string;
  value: string;
  // A second line under the value, such as the Day a record was set.
  note?: string | undefined;
}

// The headline numbers above a chart. A list, so a screen reader reads each label
// with its value.
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {stats.map(({ label, value, note }) => (
        <div key={label} className="rounded-xl bg-gray-50 p-3">
          <dt className="text-sm text-gray-600">{label}</dt>
          <dd className="text-lg font-semibold">{value}</dd>
          {note !== undefined && (
            <dd className="text-sm text-gray-600">{note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
