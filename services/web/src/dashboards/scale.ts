// Steps a reader can count in: 1, 2, 2.5 or 5 times a power of ten.
const NICE_STEPS = [1, 2, 2.5, 5, 10];

// Round tick values for a y axis that covers every value, about `count` steps
// apart: 150, 160, 170 rather than 153, 162, 171. From zero for an amount that is
// read by its size; from just under the smallest value for one read by its change.
export function niceTicks(values: number[], fromZero: boolean, count = 4) {
  if (values.length === 0) {
    return [0, 1];
  }
  const max = Math.max(...values);
  let min = fromZero ? Math.min(0, ...values) : Math.min(...values);
  // One distinct value has no span to divide. Open a little room under it.
  if (max === min) {
    min -= Math.max(1, Math.abs(max) * 0.1);
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    (NICE_STEPS.find((nice) => nice * magnitude >= rough) ?? 10) * magnitude;
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_, index) =>
    // Multiplying, not adding step by step, and trimmed: 0.1 + 0.2 is not 0.3.
    Number(((first + index) * step).toFixed(6)),
  );
}
