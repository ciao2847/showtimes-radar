import test from 'node:test';
import assert from 'node:assert/strict';
import '../chrome-extension/seat-planner.js';
import '../chrome-extension/api-booking.js';
const { reserve, chooseTicket } = globalThis.ShowtimesApiBooking;
globalThis.location = { protocol: 'https:', hostname: 'www.showtimes.com.tw', port: '', origin: 'https://www.showtimes.com.tw' };
const key = name => `https://www.showtimes.com.tw:/cinehub-frontend/${name}`;
const ticket = { id: 'adult', name: '特別場', ticketCount: 1 };
function fixture({ blocked = [], failLock = false, failPrice = false, expired = false } = {}) {
  globalThis.showtimesRadarTicketCache.clear();
  const values = new Map([[key('globalStoreUser'), JSON.stringify({ accessToken: 'test-token', jwt: 'test-jwt' })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const calls = [];
  const client = {
    auth: { setBearerToken: () => calls.push('auth') },
    app: { bootstrap: async () => ({ programs: [{ id: 13084 }], corporations: [{ id: 91 }], eventsForCorporations: { 91: { events: [{ id: 123, status: 'active', programId: 13084, corporationId: 91, startedAt: expired ? '2026-10-29T11:50:00Z' : '2026-10-29T20:00:00Z' }] } } }) },
    ticketTypes: { list: async () => [ticket] },
    seats: { listForEvent: async () => ({ seats: [1, 2, 3, 4].map((ci, i) => ({ cc: 'normal', a: 1, r: 'A', c: String(10 - ci), ri: 0, ci, x: i, y: 0, displayLabel: `A排${10-ci}號`, s: blocked.includes(ci) ? 1 : 0 })) }) },
    cart: {
      create: async cart => { calls.push('create'); assert.deepEqual(cart.ticketTypesCount, { adult: 2 }); return 'test-session'; },
      lockSeats: async cart => { calls.push('lock'); assert.equal(cart.userSessionId, 'test-session'); assert.equal(cart.seats.length, 2); if (failLock) throw new Error('座位已售出'); },
      checkPrice: async () => { calls.push('price'); if (failPrice) throw new Error('連線逾時'); return { finalPrice: 1500 }; }
    }
  };
  return { client, storage, values, calls, options: { storage, now: () => Date.parse('2026-10-29T11:30:00Z') } };
}
test('books directly through APIs and persists cart for official confirmation page', async () => {
  const f = fixture();
  const result = await reserve(f.client, { eventId: 123, quantity: 2 }, f.options);
  assert.equal(result.status, 'reserved');
  assert.match(result.url, /\/confirmOrder$/);
  assert.deepEqual(f.calls, ['auth', 'create', 'lock', 'price']);
  const cart = JSON.parse(f.storage.getItem(key('cart')));
  assert.equal(cart.finalPrice, 1500);
  assert.equal(cart.seats.length, 2);
  assert.deepEqual(cart.seats.map(s => s.ci), [1, 2]);
  assert.deepEqual(cart.seats.map(s => s.c), ['9', '8']);
  await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options), /未完成/);
  assert.equal(f.calls.filter(c => c === 'create').length, 1);
});
test('does not create cart when insufficient seats, signed out, or too close to showtime', async () => {
  for (const mode of ['insufficient', 'signedOut', 'expired']) {
    const f = fixture({ blocked: mode === 'insufficient' ? [1, 2, 3] : [], expired: mode === 'expired' });
    if (mode === 'signedOut') f.values.clear();
    await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options));
    assert.equal(f.calls.includes('create'), false);
  }
});
test('retains session after reservation or pricing failure and never blindly retries', async () => {
  for (const mode of ['failLock', 'failPrice']) {
    const f = fixture({ [mode]: true });
    await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options));
    assert.equal(f.calls.filter(c => c === 'lock').length, 1);
    assert.equal(JSON.parse(f.storage.getItem(key('cart'))).userSessionId, 'test-session');
  }
});
test('requires unambiguous eligible ticket type and accepts named packages', () => {
  assert.deepEqual(chooseTicket([ticket], '全票', 2), { adult: 2 });
  assert.deepEqual(chooseTicket([{ ...ticket, isPackageTicket: true }], '特別場', 2), { adult: 2 });
  assert.throws(() => chooseTicket([{ ...ticket, isVoucherTicket: true }], '特別場', 2), /票種/);
  assert.throws(() => chooseTicket([ticket], '另一個媽咪', 2), /票種/);
  assert.throws(() => chooseTicket([ticket, { ...ticket, id: 'other' }], '全票', 2), /票種/);
});
test('blocks duplicate creation when API create times out before returning a session ID', async () => {
  const f = fixture();
  let attempts = 0;
  f.client.cart.create = async () => { attempts++; throw new Error('連線逾時'); };
  await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options), /逾時/);
  await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options), /尚未確認/);
  assert.equal(attempts, 1);
});

test('reports actual API steps and never reports pricing after failed lock', async () => {
  const f = fixture({ failLock: true });
  const steps = [];
  await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, { ...f.options, onProgress: progress => steps.push(progress.step) }));
  assert.deepEqual(steps, ['connect', 'tickets', 'tickets', 'tickets', 'seats', 'create', 'lock']);
});

test('decodes supplied minimized seat format without confusing display number with lock indices', () => {
  const { decodeSeatMap } = globalThis.ShowtimesApiBooking;
  const map = decodeSeatMap({ payload: { seatMap: { type: 'vista-minimized-1', areas: { 1: '0000000001' }, seats: [[7, 6, '5', '7', 1, 7, 0, 1, '7', '5排7號']] } } });
  assert.deepEqual(map.seats[0], { x: 7, y: 6, r: '5', c: '7', ri: 1, ci: 7, s: 0, a: 1, cc: '0000000001', l: '7', displayLabel: '5排7號' });
});
test('reserves scattered API seats when contiguous seats are unavailable', async () => {
  const f = fixture();
  f.client.seats.listForEvent = async () => ({ seats: [0, 1].map(ri => ({ cc: '0000000001', a: 1, r: String(ri+1), c: '1', ri, ci: 0, x: 0, y: ri, s: 0, displayLabel: `${ri+1}排1號` })) });
  const log = [];
  const result = await reserve(f.client, { eventId: 123, quantity: 2 }, { ...f.options, onProgress: p => log.push(p) });
  assert.equal(result.status, 'reserved');
  const cart = JSON.parse(f.storage.getItem(key('cart')));
  assert.deepEqual(cart.seats.map(s => s.ri), [0, 1]);
  assert.match(log.find(p => p.step === 'lock').message, /1排1號、2排1號/);
});

test('reads login from the exact storage key used by official site with an empty URL port', () => {
  const f = fixture();
  assert.equal(globalThis.ShowtimesApiBooking.sessionInfo(f.storage).loggedIn, true);
  assert.deepEqual(globalThis.ShowtimesApiBooking.sessionInfo(f.storage), { loggedIn: true });
  f.values.clear();
  f.values.set('https://www.showtimes.com.tw:80/cinehub-frontend/globalStoreUser', JSON.stringify({ accessToken: 'wrong-key' }));
  assert.equal(globalThis.ShowtimesApiBooking.sessionInfo(f.storage).loggedIn, false);
});

const packageTicket = { id: 'adult', name: '《另一個媽咪》DVA特別場套票', isPackageTicket: true, ticketCount: 1 };
test('converts requested seat count to package count and rejects ambiguous or indivisible choices', () => {
  assert.deepEqual(chooseTicket([{ ...packageTicket, ticketCount: 2 }], packageTicket.name, 4), { adult: 2 });
  assert.throws(() => chooseTicket([{ ...packageTicket, ticketCount: 2 }], packageTicket.name, 3), /票種/);
  assert.throws(() => chooseTicket([packageTicket, { ...packageTicket, id: 'other' }], '另一個媽咪', 2), /唯一/);
});

test('buys ticket 1060 directly with bundled gifts without fetching or adding concessions', async () => {
  const f = fixture();
  const suppliedTicket = { ...packageTicket, id: '1060', price: 750, fee: 30, contents: { tickets: [{ id: '0035', count: 1 }], concessions: [{ id: '3305', name: '《另一個媽咪》DVA特別場．特典兌換券', count: 1 }, { id: '3307', name: '《另一個媽咪》DVA特別場', count: 1 }] }, soldOutContents: [] };
  f.client.ticketTypes.list = async () => [suppliedTicket];
  f.client.concessions = { list: async () => { throw new Error('Must not fetch concessions'); } };
  f.client.cart.addConcessions = async () => { throw new Error('Must not add concessions'); };
  let created;
  f.client.cart.create = async cart => { created = cart; return 'session-1060'; };
  f.client.cart.lockSeats = async cart => assert.equal(cart.seats.length, 4);
  const log = [];
  const result = await reserve(f.client, { eventId: 123, quantity: 4, ticketKeyword: suppliedTicket.name }, { ...f.options, onProgress: progress => log.push(progress) });
  assert.equal(result.status, 'reserved');
  assert.deepEqual(created.ticketTypesCount, { '1060': 4 });
  assert.deepEqual(created.selectedPackageConcessions, []);
  assert.deepEqual(created.selectedConcessions, []);
  assert.deepEqual(created.ticketTypes[0].contents, suppliedTicket.contents);
  assert.ok(log.some(progress => progress.message.includes('直接以套票購買')));
});
test('starts independent read APIs concurrently while serializing create and lock', async () => {
  const f = fixture();
  const started = [], release = {};
  for (const [label, object, method] of [['bootstrap', f.client.app, 'bootstrap'], ['tickets', f.client.ticketTypes, 'list'], ['seats', f.client.seats, 'listForEvent']]) {
    const original = object[method];
    object[method] = () => { started.push(label); return new Promise(resolve => { release[label] = async () => resolve(await original()); }); };
  }
  let releaseCreate;
  const create = f.client.cart.create;
  f.client.cart.create = async cart => { await new Promise(resolve => { releaseCreate = resolve; }); return create(cart); };
  const booking = reserve(f.client, { eventId: 123, quantity: 2 }, f.options);
  assert.deepEqual(started, ['bootstrap', 'tickets', 'seats']);
  assert.equal(f.calls.includes('create'), false);
  await release.bootstrap();
  await release.tickets();
  assert.equal(f.calls.includes('create'), false);
  await release.seats();
  // Let validated read results reach the create call, without relying on timing.
  for (let i = 0; !releaseCreate && i < 20; i++) await Promise.resolve();
  assert.equal(typeof releaseCreate, 'function');
  assert.equal(f.calls.includes('lock'), false);
  releaseCreate();
  assert.equal((await booking).status, 'reserved');
  assert.deepEqual(f.calls, ['auth', 'create', 'lock', 'price']);
});
test('reports actual durations and avoids cart mutation if any parallel read fails', async () => {
  const f = fixture();
  f.client.seats.listForEvent = async () => { throw new Error('座位圖取得失敗'); };
  await assert.rejects(reserve(f.client, { eventId: 123, quantity: 2 }, f.options), /座位圖取得失敗/);
  assert.equal(f.calls.includes('create'), false);
  const success = fixture();
  const progress = [];
  await reserve(success.client, { eventId: 123, quantity: 2 }, { ...success.options, onProgress: p => progress.push(p) });
  assert.ok(progress.some(p => p.step === 'lock' && p.message.includes('座位保留成功')));
  const timing = progress.find(p => p.message.startsWith('API 耗時：'));
  for (const label of ['場次', '票種', '座位圖', '建立訂票', '保留座位', '確認金額', '總計']) assert.ok(timing.message.includes(label));
});

test('reuses only a recent matching session snapshot and always refreshes seat map and tickets', async () => {
  for (const mode of ['fresh', 'stale', 'wrong-event']) {
    const f = fixture();
    let bootstraps = 0, tickets = 0, seats = 0;
    const bootstrap = f.client.app.bootstrap;
    const data = await bootstrap();
    f.client.app.bootstrap = async () => { bootstraps++; return bootstrap(); };
    const listTickets = f.client.ticketTypes.list, listSeats = f.client.seats.listForEvent;
    f.client.ticketTypes.list = async () => { tickets++; return listTickets(); };
    f.client.seats.listForEvent = async () => { seats++; return listSeats(); };
    const context = { event: { ...data.eventsForCorporations[91].events[0], id: mode === 'wrong-event' ? 124 : 123 }, program: data.programs[0], corporation: data.corporations[0], fetchedAt: f.options.now() - (mode === 'stale' ? 10_000 : 100) };
    const result = await reserve(f.client, { eventId: 123, quantity: 2, sessionContext: context }, f.options);
    assert.equal(result.status, 'reserved');
    assert.equal(bootstraps, mode === 'fresh' ? 0 : 1);
    assert.equal(tickets, 1);
    assert.equal(seats, 1);
  }
});

test('preloads tickets without mutations and reuses them while fetching live seats', async () => {
  const f = fixture();
  const config = { eventId: 123, quantity: 2, ticketKeyword: '全票', watchKey: 'watch-one' };
  let ticketReads = 0, seatReads = 0;
  const tickets = f.client.ticketTypes.list, seats = f.client.seats.listForEvent;
  f.client.ticketTypes.list = async () => { ticketReads++; return tickets(); };
  f.client.seats.listForEvent = async () => { seatReads++; return seats(); };
  assert.equal((await globalThis.ShowtimesApiBooking.prepare(f.client, config, f.options)).status, 'prepared');
  assert.deepEqual(f.calls, ['auth']);
  assert.equal(seatReads, 0);
  const log = [];
  assert.equal((await reserve(f.client, config, { ...f.options, onProgress: p => log.push(p) })).status, 'reserved');
  assert.equal(ticketReads, 1);
  assert.equal(seatReads, 1);
  assert.ok(log.some(p => p.message.includes('已沿用預載票種')));
});
test('does not reuse ticket data after expiry, account or watch changes', async () => {
  for (const mode of ['expired', 'account', 'watch', 'event', 'quantity', 'keyword']) {
    const f = fixture();
    let reads = 0;
    f.client.ticketTypes.list = async () => { reads++; return [ticket]; };
    const config = { eventId: 123, quantity: 2, ticketKeyword: '全票', watchKey: 'one' };
    await globalThis.ShowtimesApiBooking.prepare(f.client, config, f.options);
    if (mode === 'account') f.values.set(key('globalStoreUser'), JSON.stringify({ accessToken: 'another-user' }));
    const changed = { ...config, ...(mode === 'watch' ? { watchKey: 'two' } : {}), ...(mode === 'event' ? { eventId: 124 } : {}), ...(mode === 'quantity' ? { quantity: 1 } : {}), ...(mode === 'keyword' ? { ticketKeyword: ticket.name } : {}) };
    const options = mode === 'expired' ? { ...f.options, now: () => f.options.now() + 15000 } : f.options;
    await globalThis.ShowtimesApiBooking.prepare(f.client, changed, options);
    assert.equal(reads, 2, mode);
  }
});
