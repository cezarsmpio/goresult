import assert from "node:assert/strict";
import { run } from "goresult";

const sync = run(() => 42);

assert.ok(Array.isArray(sync));
assert.deepEqual(sync, [undefined, 42]);

const [syncError] = run(() => {
  throw new Error("boom");
});

assert.ok(syncError instanceof Error);
assert.equal(syncError.message, "boom");

const [asyncError, asyncValue] = await run(async () => "hello");

assert.equal(asyncError, undefined);
assert.equal(asyncValue, "hello");

const [promiseError, promiseValue] = await run(Promise.resolve("promise"));

assert.equal(promiseError, undefined);
assert.equal(promiseValue, "promise");

const [rejection] = await run(Promise.reject(new Error("rejected")));

assert.ok(rejection instanceof Error);
assert.equal(rejection.message, "rejected");

const [normalized] = run(() => {
  throw "nope";
});

assert.ok(normalized instanceof Error);
assert.equal(normalized.message, "nope");
assert.equal(normalized.cause, "nope");

console.log(`goresult works on Node ${process.version}`);
