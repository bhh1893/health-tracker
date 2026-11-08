import { describe, expect, it } from "vitest";

import { aMeal, aSet, bench } from "../test-handlers";
import {
  laggingStream,
  sessionStats,
  summarize,
  topSet,
  volume,
  wholeDays,
  type Stream,
} from "./days";

const squat = { id: "squat", name: "Squat", archived: false };

const setOn = (day: string, id: string, fields = {}) =>
  aSet({ id, day, occurred_at: `${day}T18:00:00+13:00`, ...fields });
const mealOn = (day: string, id: string) =>
  aMeal({ id, day, occurred_at: `${day}T08:00:00+13:00` });

const open = <T>(...items: T[]): Stream<T> => ({ items, done: false });
const done = <T>(...items: T[]): Stream<T> => ({ items, done: true });

describe("wholeDays", () => {
  it("shows every Day once both streams are done, newest first", () => {
    const days = wholeDays(
      done(setOn("2026-11-03", "s1")),
      done(mealOn("2026-11-05", "m1"), mealOn("2026-11-03", "m2")),
    );

    expect(days.map(({ day }) => day)).toEqual(["2026-11-05", "2026-11-03"]);
    expect(days[1]?.sessions).toHaveLength(1);
    expect(days[1]?.meals).toHaveLength(1);
  });

  it("holds back the Day a stream may still have more of", () => {
    // The next page of Sets could hold more of Nov 3, so only Nov 4 is whole.
    const days = wholeDays(
      open(setOn("2026-11-04", "s1"), setOn("2026-11-03", "s2")),
      null,
    );

    expect(days.map(({ day }) => day)).toEqual(["2026-11-04"]);
  });

  it("holds back Days the other stream has not reached yet", () => {
    // Sets are done, but Meals have only read down to Nov 5: Nov 4 may still get
    // Meals, so only Days newer than Nov 5 are whole.
    const days = wholeDays(
      done(setOn("2026-11-06", "s1"), setOn("2026-11-04", "s2")),
      open(mealOn("2026-11-06", "m1"), mealOn("2026-11-05", "m2")),
    );

    expect(days.map(({ day }) => day)).toEqual(["2026-11-06"]);
  });

  it("shows nothing before a stream's first page", () => {
    expect(wholeDays(done(setOn("2026-11-06", "s1")), open())).toEqual([]);
  });

  it("groups a Day's Sets into Sessions", () => {
    const [day] = wholeDays(
      done(
        setOn("2026-11-03", "s1"),
        setOn("2026-11-03", "s2", { exercise: squat }),
        setOn("2026-11-03", "s3"),
      ),
      null,
    );

    expect(day?.sessions.map(({ exercise }) => exercise.name)).toEqual([
      bench.name,
      squat.name,
    ]);
  });
});

describe("laggingStream", () => {
  it("reads next from the stream that has read the least far back", () => {
    expect(
      laggingStream(
        open(setOn("2026-11-02", "s")),
        open(mealOn("2026-11-05", "m")),
      ),
    ).toBe("meals");
    expect(
      laggingStream(
        open(setOn("2026-11-06", "s")),
        open(mealOn("2026-11-05", "m")),
      ),
    ).toBe("entries");
  });

  it("skips finished streams and stops when both are done", () => {
    expect(laggingStream(done(), open(mealOn("2026-11-05", "m")))).toBe(
      "meals",
    );
    expect(laggingStream(null, open(mealOn("2026-11-05", "m")))).toBe("meals");
    expect(laggingStream(done(), done())).toBeNull();
  });
});

describe("topSet and volume", () => {
  it("picks the heaviest Set, then the most reps", () => {
    const sets = [
      { reps: 8, weight_lb: 135 },
      { reps: 3, weight_lb: 155 },
      { reps: 5, weight_lb: 155 },
    ];
    expect(topSet(sets)).toEqual({ reps: 5, weight_lb: 155 });
    expect(volume(sets)).toBe(8 * 135 + 3 * 155 + 5 * 155);
  });

  it("ranks bodyweight below any weight and has no volume alone", () => {
    expect(
      topSet([
        { reps: 20, weight_lb: null },
        { reps: 5, weight_lb: 10 },
      ]),
    ).toEqual({ reps: 5, weight_lb: 10 });
    expect(volume([{ reps: 12, weight_lb: null }])).toBeNull();
  });
});

describe("summarize", () => {
  it("names the top Set of a single Exercise", () => {
    const [day] = wholeDays(
      done(
        setOn("2026-11-03", "s1", { weight_lb: 140 }),
        setOn("2026-11-03", "s2"),
      ),
      null,
    );
    expect(day && summarize(day)).toBe("2 sets, top 140 lb × 5");
  });

  it("counts Exercises, Sets and Meals for a mixed Day", () => {
    const [day] = wholeDays(
      done(
        setOn("2026-11-03", "s1"),
        setOn("2026-11-03", "s2", { exercise: squat }),
      ),
      done(mealOn("2026-11-03", "m1"), mealOn("2026-11-03", "m2")),
    );
    expect(day && summarize(day)).toBe("2 exercises, 2 sets, 2 meals");
  });

  it("counts Meals alone for a Food search", () => {
    const [day] = wholeDays(null, done(mealOn("2026-11-03", "m1")));
    expect(day && summarize(day)).toBe("1 meal");
  });
});

describe("sessionStats", () => {
  it("describes one row of the Last Sessions table", () => {
    expect(
      sessionStats({
        day: "2026-11-03",
        sets: [
          { number: 1, reps: 5, weight_lb: 135 },
          { number: 2, reps: 5, weight_lb: 145 },
        ],
      }),
    ).toEqual({ day: "2026-11-03", sets: 2, top: "145 lb × 5", volume: 1400 });
  });
});
