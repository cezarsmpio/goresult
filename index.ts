export type Result<T> =
  | readonly [error: undefined, value: T]
  | readonly [error: Error, value: undefined];

type RunThunkReturn<T> = [T] extends [never]
  ? Result<never>
  : T extends PromiseLike<unknown>
    ? Promise<Result<Awaited<T>>>
    : Result<T>;

export function run<T>(input: PromiseLike<T>): Promise<Result<Awaited<T>>>;
export function run<T>(input: () => T): RunThunkReturn<T>;
export function run<T>(
  input: PromiseLike<T> | (() => T),
): Result<Awaited<T>> | Promise<Result<Awaited<T>>> {
  try {
    const value = typeof input === "function" ? input() : input;

    if (isThenable(value)) {
      return Promise.resolve(value).then(
        (resolved): Result<Awaited<T>> => [undefined, resolved],
        (error): Result<Awaited<T>> => [toError(error), undefined],
      );
    }

    return [undefined, value] as Result<Awaited<T>>;
  } catch (error) {
    return [toError(error), undefined] as Result<Awaited<T>>;
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;

  const error = new Error(
    typeof value === "string" ? value : "Non-Error thrown",
  );
  error.cause = value;
  return error;
}
