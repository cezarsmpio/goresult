# goresult

Go-style error handling for JavaScript and TypeScript.

```ts
const [err, result] = await run(() => fetchUser(id));

if (err) {
  // the error is a value, not an exception
  console.error(err);
} else {
  console.log(result.name);
}
```

[![npm](https://img.shields.io/npm/v/goresult)](https://www.npmjs.com/package/goresult)
[![CI](https://github.com/cezarsmpio/goresult/actions/workflows/ci.yml/badge.svg)](https://github.com/cezarsmpio/goresult/actions/workflows/ci.yml)

## Why

`try/catch` moves the error away from the call. You need a variable outside the block, and a missing `catch` is easy to overlook. `goresult` returns the error as the first item of a tuple, so the value and the error stay together.

The error is first on purpose. Ignoring it then takes a visible hole: `const [, value] = await run(fn)`. If the error came last, `const [value] = await run(fn)` would drop it silently.

The result is a plain tuple. There is no `Result` class, no wrapper object, and no runtime dependency. One function does the work.

## Install

```sh
npm install goresult
```

The package is ESM only and requires Node.js 20 or newer. TypeScript types are included.

## Quick start

```ts
import { run } from "goresult";

async function loadUser(id: string) {
  const [err, user] = await run(() => fetchUser(id));

  if (err) {
    console.error("Could not load the user", err);
    return;
  }

  console.log(user.name);
}
```

`err` is always an `Error` or `undefined`. In the success branch, `user` is narrowed to the resolved type.

## API

```ts
type Result<T> =
  | readonly [error: undefined, value: T]
  | readonly [error: Error, value: undefined];

function run<T>(input: PromiseLike<T>): Promise<Result<Awaited<T>>>;
function run<T>(input: () => T): T extends PromiseLike<unknown>
  ? Promise<Result<Awaited<T>>>
  : Result<T>;
```

`run` accepts a promise or a function. A function is treated as a thunk and called.

| Input | Returns | Example |
| --- | --- | --- |
| A promise | `Promise<Result<T>>` | `run(fetchUser(id))` |
| A sync thunk | `Result<T>` | `run(() => JSON.parse(input))` |
| An async thunk | `Promise<Result<T>>` | `run(async () => fetchUser(id))` |
| A promise-returning thunk | `Promise<Result<T>>` | `run(() => fetchUser(id))` |
| A function returned by a call | Follows the returned function | `run(makeThunk("hello"))` |

Sync thunks return a tuple immediately. Promises, thenables, and async thunks return a Promise. `await` works for both, so the call site can stay uniform.

A plain value is not accepted. Wrap it in a thunk:

```ts
run(() => "hello"); // ok
run("hello");       // type error
```

A non-async function that returns a promise but throws before returning it is treated as a sync failure. The runtime returns an error tuple, while its TypeScript type says Promise. If you need a Promise on every path, declare the thunk `async` or `await` the result.

A throw that happens before `run` is called cannot be caught:

```ts
const raw = syncFunction("hello"); // if this throws, run cannot help
run(() => raw);                    // the thunk returns a plain value

run(() => syncFunction("hello"));  // the throw happens inside run
```

If `syncFunction("hello")` returns a function, `run` calls that function as a thunk.

### Sync and async

A sync thunk returns the tuple directly, with no promise and no microtask:

```ts
const [err, config] = run(() => JSON.parse(raw));

if (err) {
  console.error("Invalid JSON", err);
}
```

An async thunk returns a Promise:

```ts
const [err, user] = await run(() => fetchUser(id));

if (err) {
  console.error("Could not load the user", err);
}
```

The error slot is the same in both cases. Use `await` when the input is a promise or an async thunk. You can also `await` a sync result, which is useful when the input shape varies.

### Error normalization

A real `Error`, including a custom subclass, passes through unchanged:

```ts
class NotFoundError extends Error {}

const [err] = await run(() => findUser(id));

if (err instanceof NotFoundError) {
  // still the same instance
}
```

A non-Error throw is wrapped, with the original value in `cause`:

```ts
const [err] = run(() => {
  throw "nope";
});

if (err) {
  err.message; // "nope"
  err.cause;   // "nope"
}
```

For non-string values, the message is `"Non-Error thrown"` and the original value is in `cause`. This avoids calling an arbitrary `toString`.

### TypeScript narrowing

`Result<T>` is a discriminated tuple union, so checking `err` narrows `value`:

```ts
async function showUser(id: string) {
  const [err, user] = await run(() => fetchUser(id));

  if (err) {
    // err: Error
    // user: undefined
    return;
  }

  // err: undefined
  // user: User
  user.name;
}
```

The same narrowing works for a sync call without `await`. Check `err` first, and the value is narrowed in the other branch.

A successful result can still hold `undefined`, for example from a function that returns `void`. Check `err`, not `value`.

### Ignoring the error

The `result` comes first in Go. JavaScript destructuring lets us make an ignored error visible:

```ts
const [, user] = await run(() => fetchUser(id)); // user: User | undefined
```

The hole is deliberate. If the error were the last item, `const [user] = await run(fn)` would drop it silently.

Node callbacks have used error-first order for years, so this is also familiar JavaScript.

## Recipes

The examples assume you are inside an async function. The same pattern works in a route handler, a service, or a script.

### Native fetch

`fetch` rejects on network errors, not on HTTP error statuses. Check `response.ok` inside the thunk:

```ts
type User = { id: string; name: string };

const [err, user] = await run(async () => {
  const response = await fetch(`https://api.example.com/users/${id}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as User;
});

if (err) {
  console.error("Could not load the user", err);
  return;
}
```

Both the network failure and the HTTP failure end up in `err`.

### Axios

Axios rejects on non-2xx responses. `axios.isAxiosError` narrows the error:

```ts
import axios from "axios";
import { run } from "goresult";

const [err, response] = await run(() =>
  axios.get<User>(`/api/users/${id}`)
);

if (err) {
  if (axios.isAxiosError(err)) {
    console.error(err.response?.status, err.response?.data);
  }
  return;
}

console.log(response.data.name);
```

### Prisma

Prisma throws typed errors. Check the error class and the database code:

```ts
import { Prisma, PrismaClient } from "@prisma/client";
import { run } from "goresult";

const prisma = new PrismaClient();

const [err, user] = await run(() =>
  prisma.user.create({
    data: { email, name },
  })
);

if (err) {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    // unique constraint: the email already exists
    return;
  }

  throw err;
}
```

### Zod

`parseAsync` throws a `ZodError`. The issues are typed:

```ts
import * as z from "zod";
import { run } from "goresult";

const User = z.object({
  name: z.string(),
  age: z.number(),
});

const [err, user] = await run(() => User.parseAsync(input));

if (err) {
  if (err instanceof z.ZodError) {
    return { status: 400, issues: err.issues };
  }

  throw err;
}

user.name;
```

### OpenAI

The OpenAI SDK exports error classes for rate limits, connection failures, and API errors:

```ts
import OpenAI from "openai";
import { run } from "goresult";

const client = new OpenAI();

const [err, response] = await run(() =>
  client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-5.1",
    input: "Write a haiku about error handling.",
  })
);

if (err) {
  if (err instanceof OpenAI.RateLimitError) {
    // back off and retry later
  } else if (err instanceof OpenAI.APIError) {
    console.error(err.status, err.message);
  }
  return;
}

console.log(response.output_text);
```

### Node.js file system

Node.js system errors carry a `code` property:

```ts
import { readFile } from "node:fs/promises";
import { run } from "goresult";

const [err, contents] = await run(() =>
  readFile("config.json", "utf8")
);

if (err) {
  const code = (err as NodeJS.ErrnoException).code;

  if (code === "ENOENT") {
    console.error("Config file not found");
    return;
  }

  throw err;
}
```

### An HTTP handler

The guard clause reads top to bottom:

```ts
app.get("/users/:id", async (req, res) => {
  const [err, user] = await run(() =>
    db.findUser(req.params.id)
  );

  if (err) {
    res.status(500).json({ error: "Internal error" });
    return;
  }

  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(user);
});
```

### Many calls at once

`run` resolves every call, so `Promise.all` never rejects here:

```ts
const results = await Promise.all(
  ids.map((id) => run(() => fetchUser(id))),
);

const users = results.flatMap(([err, user]) => (err ? [] : [user]));
const errors = results.flatMap(([err]) => (err ? [err] : []));
```

## Coming from Go?

The order is reversed on purpose. Go returns the value first because it has no tuple destructuring and no way to skip a return value. JavaScript has both, so the error goes first and an ignored error costs a visible comma.

| Go | goresult |
| --- | --- |
| `user, err := findUser(id)` | `const [err, user] = await run(() => findUser(id))` |
| `if err != nil` | `if (err)` |
| `errors.Is(err, ErrNotFound)` | `err instanceof NotFoundError` |
| `panic(err)` | `throw err` |

## How it compares

`try/catch` keeps the error away from the call and makes it easy to forget a path. `await-to-js` accepts a promise only, so a synchronous throw escapes. `neverthrow` gives you a full Result type with combinators, which is more API than this needs.

`goresult` is one function and a tuple. If you want a larger result toolkit, `neverthrow` is a good choice. If you want the smallest thing that makes errors explicit, this is it.

## Benchmarks

<!-- benchmarks:start -->
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

_Node v26.10.0 on Apple M2. Median of 5 rounds, 500ms per task. Run `npm run bench` to reproduce._
<!-- benchmarks:end -->

The benchmark harness compares several implementations: `async/await`, `Promise.then`, `Promise.try`, a `new Promise` executor, and a fast path for sync thunks. It runs each candidate for several rounds in rotated order and reports the median.

Run it with:

```sh
npm run bench
```

Each run saves `benchmarks/last-run.json` and prints the difference from the previous run. Use `npm run bench -- --quick` for a shorter pass. Use `npm run bench -- --shipped-only --rounds=5 --update-readme` for a stable measurement that refreshes the table above. The full iteration history is in [`benchmarks/ITERATIONS.md`](benchmarks/ITERATIONS.md).

## Size

The published JavaScript is not minified. The numbers below show the cost after minification and compression:

| File | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `dist/index.js` | 773 B | 337 B | 280 B |
| Minified | 403 B | 249 B | 210 B |
| `dist/index.d.ts` | 406 B | 221 B | 174 B |

Zero runtime dependencies.

## Compatibility

The package is ESM only and supports Node.js 20 or newer. CI runs the full runtime test suite on Node 20, 22, 24, and 26. It also installs the packed tarball on each version and runs a smoke test against the packaged build.

The test sources are TypeScript. CI compiles them once on Node 26, then runs the compiled JavaScript on the older versions, so no TypeScript loader is needed.

## Development

```sh
npm install
npm test          # runtime tests and type tests
npm run test:dist # compile the runtime tests, then run them
npm run typecheck
npm run build
npm run bench
npm run size
```

The test runner is Node's built-in `node:test`. Node 26 runs the TypeScript test files directly, so there is no test framework or loader.

## Releases

Releases are managed by [semantic-release](https://semantic-release.gitbook.io/). A push to `main` runs the tests, works out the next version from the commit messages, updates `CHANGELOG.md`, creates a GitHub release, and publishes to npm.

Use Conventional Commits:

| Commit | Release |
| --- | --- |
| `fix: ...` | patch |
| `feat: ...` | minor |
| `feat!: ...` or `BREAKING CHANGE: ...` | major |

Before the first release, set the repository URL and the package name in `package.json`. Add an `NPM_TOKEN` secret with publish access to the npm account. The workflow also requests `id-token: write` so npm provenance works.

For a token-free setup, configure npm trusted publishing for the repository and workflow. The release workflow can use the OIDC token instead of `NPM_TOKEN`.

## License

MIT
