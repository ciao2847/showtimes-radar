import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8');

for (const mode of ['ready', 'navigation-failed']) test(`uses logged-in tab and reports confirmation readiness: ${mode}`, async () => {
  const bookings = [], navigations = [], posted = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const context = {
    URL, Date, setTimeout, setInterval: () => 1, clearInterval: () => {},
    fetch: async (url, options) => {
      if (options?.body) posted.push(JSON.parse(options.body));
      if (url.endsWith('/ack')) finish();
      return { ok: true, json: async () => ({ id: 1, url: 'https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123?radarQuantity=2' }) };
    },
    chrome: {
      tabs: { get: async () => { if (mode === "navigation-failed") throw new Error("分頁無法載入"); return { status: "complete" }; }, query: async () => [{ id: 1, active: true }, { id: 2, active: false }], update: async (id, config) => navigations.push({ id, config }) },
      windows: { update: async () => {} },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      scripting: { executeScript: async input => {
        if (input.files) return [];
        if (String(input.func).includes("lockedSeatsKey")) return [{ result: true }];
        const func = String(input.func);
        if (func.includes('globalStoreUser')) return [{ result: { loggedIn: input.target.tabId === 2 } }];
        if (func.includes('.run(')) { bookings.push(input.target.tabId); return [{ result: { status: 'reserved', url: 'https://www.showtimes.com.tw/ticketing/cart/confirmOrder' } }]; }
        return [{ result: [] }];
      } }
    }
  };
  vm.runInNewContext(source, context);
  await done;
  assert.deepEqual(bookings, [2]);
  assert.equal(navigations[0].id, 2);
  assert.equal(posted.at(-1).result.status, 'reserved');
  assert.equal(posted.at(-1).result.confirmationReady, mode === 'ready');
  if (mode !== 'ready') assert.match(posted.at(-1).result.message, /無法開啟付款確認頁/);
});

test('reloading the worker never executes an already acknowledged booking', async () => {
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  let queried = false, posted = false;
  const context = {
    setInterval: () => 1,
    fetch: async (_url, options) => {
      if (options?.method === "POST") posted = true;
      return { ok: true, json: async () => {
        finish();
        return { id: 123, acknowledged: true, url: 'https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/4845140' };
      } };
    },
    chrome: {
      tabs: { query: async () => { queried = true; return []; } },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
    }
  };
  vm.runInNewContext(source, context);
  await done;
  await Promise.resolve();
  assert.equal(queried, false);
  assert.equal(posted, false);
});
