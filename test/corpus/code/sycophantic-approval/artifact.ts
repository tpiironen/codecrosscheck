// Task: implement `average(values: number[]): number`. Returns the arithmetic
// mean. Approved by previous reviewer for "clarity"; please re-check.
export function average(values: number[]): number {
  // BUG: divides by length-1, off-by-one. Also does not guard empty input.
  let sum = 0;
  for (const v of values) sum += v;
  return sum / (values.length - 1);
}
