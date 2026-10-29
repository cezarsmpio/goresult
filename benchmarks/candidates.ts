import type { Result } from "../index.ts";

export type Input<T> = (() => T | PromiseLike<T>) | PromiseLike<T>;

export type Run = (
  input: Input<number>,
) => Result<number> | Promise<Result<number>>;

export type Candidate = {
  name: string;
  run: Run;
};

function toError(value: unknown): Error {
  if (value instanceof Error) return value;

  return new Error(
    typeof value === "string" ? value : "Non-Error thrown",
    { cause: value },
  );
}

function toErrorAssign(value: unknown): Error {
  if (value instanceof Error) return value;

  const error = new Error(
    typeof value === "string" ? value : "Non-Error thrown",
  );
  error.cause = value;
  return error;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function ok(value: number): Result<number> {
  return [undefined, value];
}

function fail(error: unknown): Result<number> {
  return [toError(error), undefined];
}

export const runThenInline: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    return Promise.resolve(value).then(
      (resolved): Result<number> => [undefined, resolved],
      (error): Result<number> => [toError(error), undefined],
    );
  } catch (error) {
    return Promise.resolve([toError(error), undefined]);
  }
};

export const runThenShared: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    return Promise.resolve(value).then(ok, fail);
  } catch (error) {
    return Promise.resolve(fail(error));
  }
};

export const runFastpath: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    if (isThenable(value)) {
      return Promise.resolve(value).then(ok, fail);
    }

    return Promise.resolve([undefined, value]);
  } catch (error) {
    return Promise.resolve(fail(error));
  }
};

export const runFastpathInline: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    if (isThenable(value)) {
      return Promise.resolve(value).then(
        (resolved): Result<number> => [undefined, resolved],
        (error): Result<number> => [toError(error), undefined],
      );
    }

    return Promise.resolve([undefined, value]);
  } catch (error) {
    return Promise.resolve([toError(error), undefined]);
  }
};

export const runFastpathCauseAssign: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    if (isThenable(value)) {
      return Promise.resolve(value).then(
        (resolved): Result<number> => [undefined, resolved],
        (error): Result<number> => [toErrorAssign(error), undefined],
      );
    }

    return Promise.resolve([undefined, value]);
  } catch (error) {
    return Promise.resolve([toErrorAssign(error), undefined]);
  }
};

export const runFastpathInstanceof: Run = (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    if (value instanceof Promise) {
      return value.then(ok, fail);
    }

    if (isThenable(value)) {
      return Promise.resolve(value).then(ok, fail);
    }

    return Promise.resolve([undefined, value]);
  } catch (error) {
    return Promise.resolve(fail(error));
  }
};

export const runAsyncAwait: Run = async (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    return [undefined, await value];
  } catch (error) {
    return [toError(error), undefined];
  }
};

export const runAsyncFastpath: Run = async (input) => {
  try {
    const value = typeof input === "function" ? input() : input;

    if (isThenable(value)) {
      return [undefined, await value];
    }

    return [undefined, value];
  } catch (error) {
    return [toError(error), undefined];
  }
};

export const runPromiseTry: Run = (input) => {
  if (typeof input === "function") {
    return Promise.try(input).then(ok, fail);
  }

  return Promise.resolve(input).then(ok, fail);
};

export const runNewPromise: Run = (input) =>
  new Promise<Result<number>>((resolve) => {
    try {
      const value = typeof input === "function" ? input() : input;

      Promise.resolve(value).then(
        (resolved) => resolve([undefined, resolved]),
        (error) => resolve(fail(error)),
      );
    } catch (error) {
      resolve(fail(error));
    }
  });

export const candidates: Candidate[] = [
  { name: "then-inline", run: runThenInline },
  { name: "then-shared", run: runThenShared },
  { name: "fastpath", run: runFastpath },
  { name: "fastpath-inline", run: runFastpathInline },
  { name: "fastpath-cause-assign", run: runFastpathCauseAssign },
  { name: "fastpath-instanceof", run: runFastpathInstanceof },
  { name: "async-await", run: runAsyncAwait },
  { name: "async-fastpath", run: runAsyncFastpath },
  ...(typeof Promise.try === "function"
    ? [{ name: "promise-try", run: runPromiseTry }]
    : []),
  { name: "new-promise", run: runNewPromise },
];
