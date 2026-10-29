import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { Bench } from "tinybench";
import { run as shipped } from "../index.ts";
import { candidates, type Input, type Run } from "./candidates.ts";

type Scenario = {
  name: string;
  makeInput: () => Input<number>;
};

type ResultRow = {
  scenario: string;
  candidate: string;
  hz: number;
  latency: number;
  rme: number;
  spread?: number;
};

type RunFile = {
  meta: {
    date: string;
    node: string;
    platform: string;
    arch: string;
    cpu: string;
    time: number;
    warmupTime: number;
    rounds?: number;
  };
  results: ResultRow[];
};

const failure = new Error("boom");

const syncValue = () => 42;
const syncThrow = () => {
  throw failure;
};
const asyncValue = async () => 42;
const asyncThrow = async () => {
  throw failure;
};
const promiseValue = () => Promise.resolve(42);
const promiseError = () => Promise.reject(failure);
const nonErrorThrow = () => {
  throw "boom";
};
const nonErrorReject = () => Promise.reject("boom");

const thenableValue = {
  then(resolve: (value: number) => void) {
    resolve(42);
  },
} as unknown as PromiseLike<number>;

const thenableError = {
  then(
    _resolve: (value: number) => void,
    reject: (reason: unknown) => void,
  ) {
    reject(failure);
  },
} as unknown as PromiseLike<number>;

const scenarios: Scenario[] = [
  { name: "sync thunk", makeInput: () => syncValue },
  { name: "sync throw", makeInput: () => syncThrow },
  { name: "promise", makeInput: () => promiseValue },
  { name: "rejected promise", makeInput: () => promiseError },
  { name: "async thunk", makeInput: () => asyncValue },
  { name: "async throw", makeInput: () => asyncThrow },
  { name: "promise thunk", makeInput: () => promiseValue },
  { name: "rejected promise thunk", makeInput: () => promiseError },
  { name: "thenable", makeInput: () => thenableValue },
  { name: "rejected thenable", makeInput: () => thenableError },
  { name: "non-Error throw", makeInput: () => nonErrorThrow },
  { name: "non-Error reject", makeInput: () => nonErrorReject },
];

const argumentsSet = new Set(process.argv.slice(2));
const quick = argumentsSet.has("--quick");
const shippedOnly = argumentsSet.has("--shipped-only");
const updateReadme = argumentsSet.has("--update-readme");
const roundsArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--rounds="));
const requestedRounds = roundsArgument
  ? Number(roundsArgument.slice("--rounds=".length))
  : undefined;
const rounds = quick ? 1 : requestedRounds ?? 3;
const time = quick ? 200 : 500;
const warmupTime = quick ? 50 : 150;
const previousPath = new URL("./last-run.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);

if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error("--rounds must be a positive integer");
}

const previous = existsSync(previousPath)
  ? (JSON.parse(readFileSync(previousPath, "utf8")) as RunFile)
  : null;

const previousByKey = new Map(
  (previous?.results ?? []).map((row) => [
    `${row.scenario} :: ${row.candidate}`,
    row,
  ]),
);

const shippedRun = shipped as unknown as Run;

const runs: { name: string; run: Run }[] = shippedOnly
  ? [{ name: "shipped", run: shippedRun }]
  : [{ name: "shipped", run: shippedRun }, ...candidates];

let sink = 0;

function makeTask(candidate: Run, scenario: Scenario) {
  return () => {
    const result = candidate(scenario.makeInput());

    if (result instanceof Promise) {
      return result.then(([error, value]) => {
        sink += error ? 1 : value;
      });
    }

    const [error, value] = result;
    sink += error ? 1 : value;
  };
}

type Sample = {
  scenario: string;
  candidate: string;
  hz: number;
  latency: number;
  rme: number;
};

const samples = new Map<string, Sample[]>();

for (let round = 0; round < rounds; round += 1) {
  const bench = new Bench({
    name: "goresult",
    time,
    warmupTime,
    iterations: 64,
    warmupIterations: 16,
  });
  const scenarioShift = round % scenarios.length;
  const candidateShift = round % runs.length;
  const orderedScenarios = [
    ...scenarios.slice(scenarioShift),
    ...scenarios.slice(0, scenarioShift),
  ];
  const orderedRuns = [
    ...runs.slice(candidateShift),
    ...runs.slice(0, candidateShift),
  ];

  console.log(`Round ${round + 1}/${rounds}`);

  for (const scenario of orderedScenarios) {
    for (const candidate of orderedRuns) {
      bench.add(
        `${scenario.name} :: ${candidate.name}`,
        makeTask(candidate.run, scenario),
      );
    }
  }

  await bench.run();

  for (const task of bench.tasks) {
    const result = task.result;

    if (result.state !== "completed") {
      throw new Error(
        `Benchmark "${task.name}" ended in state "${result.state}"`,
      );
    }

    const separator = task.name.indexOf(" :: ");
    const scenario = task.name.slice(0, separator);
    const candidate = task.name.slice(separator + 4);
    const bucket = samples.get(task.name) ?? [];

    bucket.push({
      scenario,
      candidate,
      hz: result.throughput.mean,
      latency: result.latency.mean,
      rme: result.throughput.rme,
    });
    samples.set(task.name, bucket);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }

  return sorted[middle] ?? 0;
}

const results: ResultRow[] = [...samples.values()].map((bucket) => {
  const first = bucket[0];

  if (!first) {
    throw new Error("Empty benchmark bucket");
  }

  const hzValues = bucket.map((sample) => sample.hz);
  const hz = median(hzValues);
  const min = Math.min(...hzValues);
  const max = Math.max(...hzValues);

  return {
    scenario: first.scenario,
    candidate: first.candidate,
    hz,
    latency: median(bucket.map((sample) => sample.latency)),
    rme: median(bucket.map((sample) => sample.rme)),
    spread: hz === 0 ? 0 : ((max - min) / hz) * 100,
  };
});

function roundsLabel(count: number): string {
  return `${count} round${count === 1 ? "" : "s"}`;
}

function candidatesLabel(count: number): string {
  return `${count} candidate${count === 1 ? "" : "s"}`;
}

function formatHz(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)}k`;
  return hz.toFixed(0);
}

function formatNs(latencyMs: number): string {
  const ns = latencyMs * 1_000_000;
  return ns >= 100 ? ns.toFixed(0) : ns.toFixed(1);
}

function formatDelta(current: number, previousValue: number): string {
  const delta = ((current - previousValue) / previousValue) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatSpread(spread: number | undefined): string {
  if (spread === undefined) return "-";
  return `+/-${spread.toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

console.log(
  `\nNode ${process.version} on ${cpus()[0]?.model ?? "unknown CPU"} (${platform()} ${arch()})`,
);
console.log(
  `${roundsLabel(rounds)}, ${time}ms per task, ${warmupTime}ms warmup, ${scenarios.length} scenarios, ${candidatesLabel(runs.length)}\n`,
);

if (previous) {
  const currentCpu = cpus()[0]?.model ?? "unknown CPU";
  const previousCpu = previous.meta.cpu ?? "unknown CPU";

  if (previous.meta.node !== process.version || previousCpu !== currentCpu) {
    console.log(
      `Note: previous run was Node ${previous.meta.node} on ${previousCpu}.`,
    );
    console.log("Deltas may include machine or runtime differences.\n");
  } else if (
    previous.meta.time !== time ||
    (previous.meta.rounds ?? 1) !== rounds
  ) {
    console.log(
      `Note: previous run used ${roundsLabel(previous.meta.rounds ?? 1)} at ${previous.meta.time}ms, current run uses ${roundsLabel(rounds)} at ${time}ms.\n`,
    );
  }
}

for (const scenario of scenarios) {
  const rows = results
    .filter((row) => row.scenario === scenario.name)
    .sort((left, right) => right.hz - left.hz);
  const best = rows[0]?.hz ?? 0;

  console.log(scenario.name);

  for (const row of rows) {
    const key = `${row.scenario} :: ${row.candidate}`;
    const previousRow = previousByKey.get(key);
    const previousDelta = previousRow
      ? formatDelta(row.hz, previousRow.hz)
      : "new";
    const relative =
      row.hz === best ? "best" : `${(best / row.hz).toFixed(2)}x`;

    console.log(
      `  ${pad(row.candidate, 22)} ${padStart(formatHz(row.hz), 9)} ops/s  ${padStart(formatNs(row.latency), 8)} ns/op  ${padStart(formatSpread(row.spread), 9)}  ${padStart(relative, 6)}  ${padStart(previousDelta, 8)}`,
    );
  }

  console.log("");
}

const payload: RunFile = {
  meta: {
    date: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown CPU",
    time,
    warmupTime,
    rounds,
  },
  results,
};

writeFileSync(previousPath, `${JSON.stringify(payload, null, 2)}\n`);

if (updateReadme) {
  const startMarker = "<!-- benchmarks:start -->";
  const endMarker = "<!-- benchmarks:end -->";
  const readme = readFileSync(readmePath, "utf8");
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md is missing ${startMarker} and ${endMarker}`);
  }

  const shippedRows = results.filter((row) => row.candidate === "shipped");
  const table = [
    startMarker,
    "| Scenario | ops/sec | ns/op | spread |",
    "| --- | ---: | ---: | ---: |",
    ...shippedRows.map(
      (row) =>
        `| ${row.scenario} | ${formatHz(row.hz)} | ${formatNs(row.latency)} | ${formatSpread(row.spread)} |`,
    ),
    "",
    `_Node ${process.version} on ${cpus()[0]?.model ?? "unknown CPU"}. Median of ${roundsLabel(rounds)}, ${time}ms per task. Run \`npm run bench\` to reproduce._`,
    endMarker,
  ].join("\n");

  writeFileSync(
    readmePath,
    `${readme.slice(0, start)}${table}${readme.slice(end + endMarker.length)}`,
  );

  console.log("Updated the benchmark table in README.md");
}

void sink;
