# Benchmark iterations

The benchmark harness lives in `benchmarks/run.ts`. Candidates are in `benchmarks/candidates.ts`. Every run is compared with the previous one, and `benchmarks/last-run.json` is gitignored.

The numbers below come from a MacBook Air with an Apple M2, Node 26.10.0. Treat them as relative measurements, not universal constants. Compare candidates within the same run.

Rounds 1 to 5 were measured with the original async-only API. The final section covers the polymorphic sync return added on 2026-10-29.

## Round 1: initial candidates

The first pass compared the initial `.then` implementation with an `async/await` version, a `Promise.try` version, a `new Promise` executor, and a fast path for sync values.

| Scenario | Initial `.then` | Fast path | Difference |
| --- | ---: | ---: | ---: |
| Sync thunk | 6.14M ops/s | 8.42M ops/s | Fast path 37% faster |
| Promise | 6.22M ops/s | 6.21M ops/s | Even |
| Rejected promise | 2.02M ops/s | 2.11M ops/s | Fast path about even |
| Sync throw | 3.10M ops/s | 3.08M ops/s | Even |

The fast path won the common sync case by a wide margin and stayed within noise on async paths. `Promise.try` was much slower on sync throws, 1.39M ops/s against about 3.1M ops/s. `new Promise` was slower across the board.

Decision: keep the fast path.

## Round 2: native promise check

A variant checked `value instanceof Promise` before the thenable check, hoping to skip `Promise.resolve` for native promises.

| Scenario | Fast path | `instanceof` variant |
| --- | ---: | ---: |
| Sync thunk | 8.69M ops/s | 8.71M ops/s |
| Promise | 6.41M ops/s | 6.32M ops/s |
| Sync throw | 3.11M ops/s | 3.11M ops/s |

The difference was inside the noise. The extra branch and code were not worth it.

Decision: keep the simpler fast path.

## Round 3: error normalization

The original normalizer used `new Error(message, { cause: value })`. A variant created the error first and assigned `cause` afterwards.

| Scenario | Options object | Assign `cause` |
| --- | ---: | ---: |
| Non-Error throw | 471k ops/s | 513k ops/s |
| Non-Error reject | 699k ops/s | 739k ops/s |
| Normal success paths | - | Within noise |

The assignment avoids the options object on the error path and costs nothing on the success path.

Decision: assign `cause` after creating the error.

## Round 4: full comparison

The full run used 3 rounds at 500ms per task. The laptop throttled during the long run, and the spread between rounds reached 10-30% on some cases. The relative order still showed the fast path ahead on sync thunks by about 30%.

`Promise.try` remained the fastest option for a rare non-Error synchronous throw, 548k ops/s against 477k ops/s for the fast path. It lost badly on normal sync success and on Error throws, so it was rejected.

The full run was useful for ordering, but not for final numbers.

## Round 5: final shipped-only run

The final pass measured only the shipped implementation, 5 rounds at 500ms per task. This keeps the laptop cool enough to produce a spread under 8%.

| Scenario | ops/sec | ns/op | spread |
| --- | ---: | ---: | ---: |
| sync thunk | 8.28M | 140 | +/-2.9% |
| sync throw | 3.14M | 348 | +/-3.3% |
| promise | 6.19M | 180 | +/-6.8% |
| rejected promise | 2.11M | 509 | +/-7.5% |
| async thunk | 6.23M | 182 | +/-4.6% |
| async throw | 1.72M | 631 | +/-1.8% |
| promise thunk | 6.25M | 171 | +/-5.8% |
| rejected promise thunk | 2.14M | 519 | +/-3.7% |
| thenable | 5.36M | 213 | +/-6.1% |
| rejected thenable | 5.36M | 209 | +/-4.3% |
| non-Error throw | 515.76k | 2061 | +/-5.0% |
| non-Error reject | 738.82k | 1414 | +/-6.5% |

## Final decision

The shipped `run` uses:

- A try/catch around the thunk or promise input.
- A fast return of `Promise.resolve([undefined, value])` when the thunk returns a non-thenable.
- A `.then` handler for promises and thenables.
- Error normalization with `cause` assigned after the error is created.

This keeps the promise machinery out of the common sync path. It stays within noise of the alternatives on async paths, and it avoids the much worse sync results from `Promise.try` and `new Promise`.

## Polymorphic sync return

On 2026-10-29 the API changed so a sync thunk returns a tuple directly. The async path is unchanged. The shipped-only run, 5 rounds at 500ms per task:

| Scenario | ops/sec | ns/op | spread |
| --- | ---: | ---: | ---: |
| sync thunk | 27.68M | 28.8 | +/-7.5% |
| sync throw | 4.89M | 214 | +/-5.7% |
| promise | 6.87M | 170 | +/-9.9% |
| rejected promise | 2.20M | 521 | +/-6.4% |
| async thunk | 6.96M | 158 | +/-9.7% |
| async throw | 1.76M | 618 | +/-8.2% |
| promise thunk | 6.86M | 162 | +/-9.2% |
| rejected promise thunk | 2.20M | 494 | +/-4.8% |
| thenable | 5.97M | 184 | +/-2.3% |
| rejected thenable | 5.88M | 190 | +/-3.4% |
| non-Error throw | 566.75k | 1853 | +/-1.1% |
| non-Error reject | 768.33k | 1356 | +/-1.4% |

The sync thunk path went from 8.28M to 27.68M ops/sec, about 3.3 times faster, because it no longer allocates a promise. The sync throw path improved by 56 percent. Async numbers stayed in the same range.

The minified JavaScript is 403 bytes, 249 bytes gzipped, with no runtime dependencies. The declaration file grew to 406 bytes because of the overloads and conditional return type.
