import { run, type Result } from "../index.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

type _ResultShape = Expect<
  Equal<
    Result<number>,
    | readonly [error: undefined, value: number]
    | readonly [error: Error, value: undefined]
  >
>;

const syncThunk = run(() => 42);
type _SyncThunk = Expect<Equal<typeof syncThunk, Result<number>>>;

const asyncThunk = run(async () => 42);
type _AsyncThunk = Expect<Equal<typeof asyncThunk, Promise<Result<number>>>>;

const promiseThunk = run(() => Promise.resolve(42));
type _PromiseThunk = Expect<Equal<typeof promiseThunk, Promise<Result<number>>>>;

const promiseInput = run(Promise.resolve(42));
type _PromiseInput = Expect<Equal<typeof promiseInput, Promise<Result<number>>>>;

const thenableInput = run({ then() {} } as PromiseLike<number>);
type _ThenableInput = Expect<Equal<typeof thenableInput, Promise<Result<number>>>>;

const voidThunk = run(async () => {});
type _VoidThunk = Expect<Equal<typeof voidThunk, Promise<Result<void>>>>;

const undefinedThunk = run(() => undefined);
type _UndefinedThunk = Expect<Equal<typeof undefinedThunk, Result<undefined>>>;

const functionThunk = run((): (() => number) => () => 1);
type _FunctionThunk = Expect<Equal<typeof functionThunk, Result<() => number>>>;

declare function syncFunction(input: string): () => string;
const fromFunction = run(syncFunction("hello"));
type _FromFunction = Expect<Equal<typeof fromFunction, Result<string>>>;

const unionThunk = run((): number | Promise<number> => 42);
type _UnionThunk = Expect<
  Equal<typeof unionThunk, Result<number> | Promise<Result<number>>>
>;

const throwThunk = run((): never => {
  throw new Error("boom");
});
type _ThrowThunk = Expect<Equal<typeof throwThunk, Result<never>>>;

declare function valueFunction(input: string): string;
// @ts-expect-error a plain value is not accepted
run(valueFunction("hello"));

// @ts-expect-error a number is not accepted
run(42);

// @ts-expect-error a string is not accepted
run("hello");

// @ts-expect-error an argument is required
run();

function narrowsSync() {
  const [err, value] = run(() => 42);

  if (err) {
    type _Error = Expect<Equal<typeof err, Error>>;
    type _Value = Expect<Equal<typeof value, undefined>>;
  } else {
    type _Error = Expect<Equal<typeof err, undefined>>;
    type _Value = Expect<Equal<typeof value, number>>;
  }
}

async function narrowsAsync() {
  const [err, value] = await run(async () => 42);

  if (err) {
    type _Error = Expect<Equal<typeof err, Error>>;
    type _Value = Expect<Equal<typeof value, undefined>>;
  } else {
    type _Error = Expect<Equal<typeof err, undefined>>;
    type _Value = Expect<Equal<typeof value, number>>;
  }
}

async function narrowsAsyncWithExplicitUndefinedCheck() {
  const [err, value] = await run(Promise.resolve("hello"));

  if (err !== undefined) {
    type _Error = Expect<Equal<typeof err, Error>>;
    type _Value = Expect<Equal<typeof value, undefined>>;
  } else {
    type _Error = Expect<Equal<typeof err, undefined>>;
    type _Value = Expect<Equal<typeof value, string>>;
  }
}
