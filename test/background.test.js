import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8');

test('selects logged-in tab over active signed-out tab without exposing session credentials', async () => {
  const bookings = [], navigations = [], posted = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const context = {
    URL, setInterval: () => 1, clearInterval: () => {},
    fetch: async (url, options) => {
      if (options?.body) posted.push(JSON.parse(options.body));
      if (url.endsWith('/ack')) finish();
      return { ok: true, json: async () => ({ id: 1, url: 'https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123?radarQuantity=2' }) };
    },
    chrome: {
      tabs: { query: async () => [{ id: 1, active: true }, { id: 2, active: false }], update: async (id, config) => navigations.push({ id, config }) },
      windows: { update: async () => {} },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      scripting: { executeScript: async input => {
        if (input.files) return [];
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
});
