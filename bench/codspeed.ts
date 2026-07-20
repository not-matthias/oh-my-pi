/**
 * Shared CodSpeed + tinybench harness for omp benchmark suites.
 *
 * Usage in a `.codbench.ts` file:
 *
 * ```ts
 * import { createBench } from "../../bench/codspeed";
 * const bench = createBench();
 * bench.add("my-bench", () => { /* ... *\/ });
 * await bench.run();
 * console.table(bench.table());
 * ```
 *
 * Under `bun` locally this runs as native tinybench (no instrumentation).
 * Under CodSpeed CI (codspeed-macro runners, walltime mode) the
 * `@codspeed/tinybench-plugin` hooks fire and report per-bench metrics.
 */
import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";

export function createBench(): Bench {
	return withCodSpeed(new Bench());
}
