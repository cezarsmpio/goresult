import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "../index.ts";

const boom = new Error("boom");

describe("run", () => {
  it("returns a tuple synchronously for a sync thunk", () => {
    const result = run(() => 42);

    assert.ok(Array.isArray(result));
    assert.deepEqual(result, [undefined, 42]);
  });

  it("resolves a value from a sync thunk when awaited", async () => {
    const [err, value] = await run(() => 42);

    assert.equal(err, undefined);
    assert.equal(value, 42);
  });

  it("returns a Promise for a promise input", () => {
    const result = run(Promise.resolve(42));

    assert.ok(result instanceof Promise);
  });

  it("returns a Promise for an async thunk", () => {
    const result = run(async () => 42);

    assert.ok(result instanceof Promise);
  });

  it("returns a Promise for a thunk that returns a promise", () => {
    const result = run(() => Promise.resolve(42));

    assert.ok(result instanceof Promise);
  });

  it("awaits a promise", async () => {
    const [err, value] = await run(Promise.resolve("hello"));

    assert.equal(err, undefined);
    assert.equal(value, "hello");
  });

  it("awaits an async thunk", async () => {
    const [err, value] = await run(async () => "hello");

    assert.equal(err, undefined);
    assert.equal(value, "hello");
  });

  it("awaits a thunk that returns a promise", async () => {
    const [err, value] = await run(() => Promise.resolve(7));

    assert.equal(err, undefined);
    assert.equal(value, 7);
  });

  it("captures a synchronous throw from a thunk", async () => {
    const [err, value] = await run(() => {
      throw boom;
    });

    assert.equal(err, boom);
    assert.equal(value, undefined);
  });

  it("captures a rejection", async () => {
    const [err, value] = await run(Promise.reject(boom));

    assert.equal(err, boom);
    assert.equal(value, undefined);
  });

  it("captures an async throw", async () => {
    const [err, value] = await run(async () => {
      throw boom;
    });

    assert.equal(err, boom);
    assert.equal(value, undefined);
  });

  it("normalizes a string rejection and keeps it as the cause", async () => {
    const [err, value] = await run(Promise.reject("nope"));

    assert.ok(err instanceof Error);
    assert.equal(err.message, "nope");
    assert.equal(err.cause, "nope");
    assert.equal(value, undefined);
  });

  it("normalizes a non-string sync throw", async () => {
    const [err] = await run(() => {
      throw 42;
    });

    assert.ok(err instanceof Error);
    assert.equal(err.message, "Non-Error thrown");
    assert.equal(err.cause, 42);
  });

  it("normalizes null and undefined throws", async () => {
    const [nullError] = await run(() => {
      throw null;
    });

    assert.ok(nullError instanceof Error);
    assert.equal(nullError.message, "Non-Error thrown");
    assert.equal(nullError.cause, null);

    const [undefinedError] = await run(() => {
      throw undefined;
    });

    assert.ok(undefinedError instanceof Error);
    assert.equal(undefinedError.message, "Non-Error thrown");
    assert.equal(undefinedError.cause, undefined);
    assert.ok(Object.hasOwn(undefinedError, "cause"));
  });

  it("normalizes a non-Error rejection from a thunk", async () => {
    const [err] = await run(() => Promise.reject("nope"));

    assert.ok(err instanceof Error);
    assert.equal(err.message, "nope");
    assert.equal(err.cause, "nope");
  });

  it("keeps the identity of custom error classes", async () => {
    class HttpError extends Error {
      status = 404;
    }

    const error = new HttpError("not found");
    const [err] = await run(async () => {
      throw error;
    });

    assert.equal(err, error);
    assert.ok(err instanceof HttpError);
  });

  it("calls a thunk exactly once", async () => {
    let calls = 0;

    await run(() => {
      calls += 1;
      return "value";
    });

    assert.equal(calls, 1);
  });

  it("returns an error tuple instead of throwing", () => {
    const result = run(() => {
      throw boom;
    });

    assert.deepEqual(result, [boom, undefined]);
  });

  it("returns a tuple when a promise-returning thunk throws before returning", () => {
    const result = run(() => {
      throw boom;
      return Promise.resolve(1);
    });

    assert.deepEqual(result, [boom, undefined]);
  });

  it("accepts a thenable", async () => {
    const thenable = {
      then(resolve: (value: number) => void) {
        resolve(7);
      },
    } as unknown as PromiseLike<number>;

    const [err, value] = await run(thenable);

    assert.equal(err, undefined);
    assert.equal(value, 7);
  });

  it("accepts a thunk that returns a thenable", async () => {
    const thenable = {
      then(resolve: (value: number) => void) {
        resolve(8);
      },
    } as unknown as PromiseLike<number>;

    const [err, value] = await run(() => thenable);

    assert.equal(err, undefined);
    assert.equal(value, 8);
  });

  it("normalizes a thenable whose then throws", async () => {
    const badThenable = {
      then() {
        throw boom;
      },
    } as unknown as PromiseLike<number>;

    const [err, value] = await run(badThenable);

    assert.equal(err, boom);
    assert.equal(value, undefined);
  });

  it("keeps concurrent runs separate", async () => {
    const delay = (value: string, ms: number) =>
      new Promise<string>((resolve) => setTimeout(resolve, ms, value));

    const [[firstError, first], [secondError, second]] = await Promise.all([
      run(() => delay("first", 5)),
      run(() => delay("second", 1)),
    ]);

    assert.equal(firstError, undefined);
    assert.equal(secondError, undefined);
    assert.equal(first, "first");
    assert.equal(second, "second");
  });

  it("treats undefined as a successful value", async () => {
    const [err, value] = await run(() => undefined);

    assert.equal(err, undefined);
    assert.equal(value, undefined);
  });

  it("treats void as a successful value", async () => {
    const [err, value] = await run(async () => {});

    assert.equal(err, undefined);
    assert.equal(value, undefined);
  });

  it("calls a function returned by another function", async () => {
    const makeThunk = (value: string) => () => value;
    const [err, value] = await run(makeThunk("hello"));

    assert.equal(err, undefined);
    assert.equal(value, "hello");
  });
});
