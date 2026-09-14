import assert from "node:assert/strict";
import test from "node:test";
import { installExternalWebLinks } from "@minke/harness-overlay/client/tabs/web/interceptor.ts";

function fixture() {
  const listeners = new Map();
  const opened = [];
  const root = {
    defaultView: { location: { origin: "http://127.0.0.1:12345" } },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
  };
  const dispose = installExternalWebLinks(url => opened.push(url), root);
  function click(href, overrides = {}, download = false) {
    const event = { button: 0, defaultPrevented: false, altKey: false,
      composedPath: () => [{ tagName: "SPAN" }, { tagName: "A", href, hasAttribute: () => download }],
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...overrides };
    listeners.get(event.button === 1 ? "auxclick" : "click")(event);
    return event;
  }
  return { opened, listeners, dispose, click };
}

test("normal, modified and middle clicks open in the system browser", () => {
  const { opened, click } = fixture();
  for (const options of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    assert.equal(click("https://example.com/docs", options).defaultPrevented, true);
  }
  assert.deepEqual(opened, Array(5).fill("https://example.com/docs"));
});

test("internal routes, hashes, downloads and unsupported schemes are not hijacked", () => {
  const { opened, click } = fixture();
  for (const url of ["http://127.0.0.1:12345/#section", "http://127.0.0.1:12345/session/1", "file:///C:/report.txt", "javascript:alert(1)"]) {
    assert.equal(click(url).defaultPrevented, false);
  }
  assert.equal(click("https://example.com/file", {}, true).defaultPrevented, false);
  click("https://example.com", { defaultPrevented: true });
  click("https://example.com", { button: 2 });
  assert.deepEqual(opened, []);
});

test("disposing external links removes both listeners", () => {
  const { listeners, dispose } = fixture();
  dispose();
  assert.equal(listeners.size, 0);
});
