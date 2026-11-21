import assert from "node:assert/strict";
import test from "node:test";
import { Slots } from "./verify.mjs";

test("Slots limits concurrency to its capacity", async () => {
  const slots = new Slots();
  slots.capacity = 2;
  let running = 0;
  let maxRunning = 0;
  const run = async (id) =>
    slots.using(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running--;
      return id;
    });
  const results = await Promise.all([run(1), run(2), run(3), run(4)]);
  assert.deepEqual(results, [1, 2, 3, 4]);
  assert.equal(maxRunning, 2);
  assert.equal(running, 0);
});

test("Slots prioritizes priority tasks over normal queued tasks", async () => {
  const slots = new Slots();
  slots.capacity = 1;
  const order = [];
  let unblock;
  const blocker = new Promise((resolve) => { unblock = resolve; });
  const blockTask = slots.using(() => blocker);
  const normalTask = slots.using(async () => { order.push("normal"); }, 1, () => {}, false);
  const priorityTask = slots.using(async () => { order.push("priority"); }, 1, () => {}, true);
  unblock();
  await Promise.all([blockTask, normalTask, priorityTask]);
  assert.deepEqual(order, ["priority", "normal"]);
});

test("Slots frees slot when task throws an error", async () => {
  const slots = new Slots();
  slots.capacity = 1;
  await assert.rejects(
    slots.using(async () => {
      throw new Error("task failed");
    }),
    /task failed/,
  );
  assert.equal(slots.running, 0);
  let ran = false;
  await slots.using(async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("Slots passes wait time to onWait callback", async () => {
  const slots = new Slots();
  slots.capacity = 1;
  let waitedMs = -1;
  let unblock;
  const blocker = new Promise((resolve) => { unblock = resolve; });
  const first = slots.using(() => blocker);
  const second = slots.using(
    async () => {},
    1,
    (ms) => { waitedMs = ms; },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  unblock();
  await Promise.all([first, second]);
  assert.ok(waitedMs >= 15);
});
