import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { useExerciseHistory } from "./queries";
import { StatTiles } from "./StatTiles";
import { historyStart, sessionPoints, summarizeExercise } from "./stats";
import { TrendChart } from "./TrendChart";

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const pounds = (value: number) => `${WHOLE.format(value)} lb`;
const reps = (value: number) => `${WHOLE.format(value)} reps`;
const signed = (value: number, format: (value: number) => string) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;

interface ExerciseDashboardProps {
  exerciseId: string;
  // Null means all of history.
  from: string | null;
  to: string;
}

// "How is this Exercise progressing?" (ADR 0024): the top Set and the volume of
// each Session in the range, read from GET /exercises/{id}/sessions.
export function ExerciseDashboard({
  exerciseId,
  from,
  to,
}: ExerciseDashboardProps) {
  const history = useExerciseHistory(exerciseId, from, to);

  if (history.error) {
    return <ProblemAlert error={history.error} />;
  }
  if (history.data === undefined) {
    return (
      <p role="status" className="text-faint">
        Loading...
      </p>
    );
  }
  const points = sessionPoints(history.data);
  if (points.length === 0) {
    return <p className="text-faint">No Sessions in this range.</p>;
  }

  const summary = summarizeExercise(points);
  const byWeight = summary.measure === "weight";
  const format = byWeight ? pounds : reps;
  const start =
    from ??
    historyStart(
      points.map((point) => point.day),
      to,
    );
  const count = (sets: number) =>
    `${String(sets)} ${sets === 1 ? "Set" : "Sets"}`;

  return (
    <>
      <TrendChart
        title={byWeight ? "Top Set weight" : "Top Set reps"}
        measures="exercise"
        from={start}
        to={to}
        fromZero={false}
        formatValue={format}
        points={points
          // A bodyweight Session has no weight to plot once the Exercise is
          // tracked by weight. It still counts above and in the volume chart.
          .filter((point) => !byWeight || point.topWeight !== null)
          .map((point) => ({
            day: point.day,
            value: byWeight ? point.topWeight : point.topReps,
            detail: `${point.top}, ${count(point.sets)}`,
          }))}
      />
      <StatTiles
        stats={[
          { label: "Sessions", value: String(summary.sessions) },
          {
            label: "Best top Set",
            value: summary.best?.top ?? "",
            note: summary.best ? formatDay(summary.best.day) : undefined,
          },
          {
            label: "Change",
            value:
              summary.change === null ? "–" : signed(summary.change, format),
            note: "first to last",
          },
        ]}
      />
      {points.some((point) => point.volume !== null) && (
        <TrendChart
          title="Volume"
          measures="exercise"
          from={start}
          to={to}
          fromZero={false}
          formatValue={pounds}
          points={points
            .filter((point) => point.volume !== null)
            .map((point) => ({
              day: point.day,
              value: point.volume,
              detail: count(point.sets),
            }))}
        />
      )}
    </>
  );
}
