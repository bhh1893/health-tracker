import { Link } from "react-router";

import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { sessionStats } from "./days";
import { useLastSessions } from "./queries";

const cellClass = "border-b border-gray-100 py-2 pr-2";

const formatVolume = (volume: number | null) =>
  volume === null ? "BW" : `${volume.toLocaleString("en-US")} lb`;

// "How am I progressing?": the last N Sessions of one Exercise, newest first
// (ADR 0013), one call to GET /exercises/{id}/sessions.
export function LastSessions({
  exerciseId,
  last,
}: {
  exerciseId: string;
  last: number;
}) {
  const sessions = useLastSessions(exerciseId, last);

  if (sessions.error) {
    return <ProblemAlert error={sessions.error} />;
  }
  if (sessions.data === undefined) {
    return (
      <p role="status" className="text-gray-500">
        Loading...
      </p>
    );
  }
  if (sessions.data.length === 0) {
    return <p className="text-gray-500">No Sessions yet.</p>;
  }
  return (
    <table className="w-full text-left text-base">
      <caption className="sr-only">Last Sessions</caption>
      <thead className="text-sm text-gray-500">
        <tr>
          <th className={cellClass}>Day</th>
          <th className={cellClass}>Sets</th>
          <th className={cellClass}>Top set</th>
          <th className={cellClass}>Volume</th>
        </tr>
      </thead>
      <tbody>
        {sessions.data.map(sessionStats).map((row) => (
          <tr key={row.day}>
            <td className={cellClass}>
              <Link
                className="text-teal-700 underline"
                to={`/exercise?day=${row.day}`}
              >
                {formatDay(row.day)}
              </Link>
            </td>
            <td className={cellClass}>{row.sets}</td>
            <td className={cellClass}>{row.top}</td>
            <td className={cellClass}>{formatVolume(row.volume)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
