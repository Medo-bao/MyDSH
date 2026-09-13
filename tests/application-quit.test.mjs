import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  requestApplicationQuit,
} from "@minke/desktop/main/application-quit.ts";

function fakeApplication() {
  const events = new EventEmitter();
  const calls = { exit: 0, quit: 0 };
  return {
    application: {
      exit() {
        calls.exit += 1;
      },
      once: events.once.bind(events),
      quit() {
        calls.quit += 1;
      },
    },
    calls,
    events,
  };
}

test("tray quit forces process exit when graceful shutdown stalls", async () => {
  const fixture = fakeApplication();
  requestApplicationQuit(fixture.application, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(fixture.calls, { exit: 1, quit: 1 });
});

test("successful Electron quit cancels the force-exit fallback", async () => {
  const fixture = fakeApplication();
  requestApplicationQuit(fixture.application, 5);
  fixture.events.emit("quit");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(fixture.calls, { exit: 0, quit: 1 });
});
