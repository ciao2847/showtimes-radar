import assert from"node:assert/strict";import test from"node:test";import{matchesSession,validateWatchConfig}from"../src/watch-service.js";import{parseShowtimesSeatLabel,rankSeatGroups,ticketQuantityDelta}from"../src/booking-flow.js";
test("validates config",()=>{const value=validateWatchConfig({movie:" 粉絲場 ",date:"2026-09-06",quantity:"2",autoOpen:"false"});assert.equal(value.movie,"粉絲場");assert.equal(value.quantity,2);assert.equal(value.autoOpen,false)});
test("matches special session filters",()=>{assert.equal(matchesSession({movie:"攻殼粉絲場",date:"2026-09-06",time:"14:00",cinema:"大巨蛋秀泰",room:"4DX"},{movie:"攻殼",date:"2026-09-06",cinema:"大巨蛋",room:"4DX"}),true)});
test("ranks contiguous seats",()=>{const seats=[1,2,4,5].map((number,index)=>({row:"A",number,index}));const result=rankSeatGroups(seats,2);assert.equal(result.length,2);assert.equal(result[1].number,result[0].number+1)});
test("adjusts from the quantity currently shown by Showtimes",()=>{assert.equal(ticketQuantityDelta(1,3),2);assert.equal(ticketQuantityDelta(3,1),-2);assert.equal(ticketQuantityDelta(2,2),0)});
test("parses Showtimes numeric seat labels",()=>{assert.deepEqual(parseShowtimesSeatLabel("座位 18排1號"),{row:"18",number:1,label:"18排1號"})});
test("does not join seats across a physical aisle",()=>{const seats=[{row:"10",number:5,x:720},{row:"10",number:6,x:648},{row:"10",number:7,x:612}];assert.deepEqual(rankSeatGroups(seats,2).map(s=>s.number),[6,7])});

import { createWatchService } from "../src/watch-service.js";
test("accepts program URL without keyword and matches only its program ID", () => {
  const config = validateWatchConfig({ program: "https://www.showtimes.com.tw/programs/13084", date: "2026-10-29" });
  assert.equal(config.programId, "13084");
  assert.equal(matchesSession({ programId: 13084, date: config.date }, config), true);
  assert.equal(matchesSession({ programId: 13083, date: config.date }, config), false);
  assert.throws(() => validateWatchConfig({ program: "https://example.com/programs/13084", date: config.date }), /網址/);
});
test("polls until enough seats appear before starting booking", async () => {
  let nextScan, seats = 0;
  const bookings = [];
  const service = createWatchService({ prepareBooking: async () => null,
    setTimeoutFn: fn => { nextScan = fn; return 1; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [{ id: 1, movie: "特別場", date: "2026-10-29", availableSeats: seats, url: "https://example.com/1" }],
    startBooking: async input => { bookings.push(input); return { status: "manualHandoff" }; }
  });
  service.start({ movie: "特別場", date: "2026-10-29", quantity: 2 });
  for (const count of [0, null, 1]) { seats = count; await nextScan(); assert.equal(bookings.length, 0); }
  seats = 2;
  await nextScan();
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].quantity, 2);
  await nextScan();
  assert.equal(bookings.length, 1);
  service.stop();
});

test("keeps a reserved booking active and does not navigate to another matching session", async () => {
  let scan;
  let bookings = 0;
  const service = createWatchService({ prepareBooking: async () => null,
    setTimeoutFn: fn => { scan = fn; return 1; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [1, 2].map(id => ({ id, movie: "泥面人 特別場", date: "2026-10-29", availableSeats: 2, url: `https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/${id}` })),
    startBooking: async input => { bookings++; input.onResult({ status: "reserved", message: "保留成功" }); return { status: "reserved" }; }
  });
  service.start({ movie: "泥面人", date: "2026-10-29", quantity: 2 });
  await scan();
  await scan();
  assert.equal(bookings, 1);
  assert.equal(service.getState().bookingActive, true);
  service.stop();
});

test('keeps failed reservation step visible with timestamped history', async () => {
  const service = createWatchService({ prepareBooking: async () => null, startBooking: async input => {
    input.onProgress({ step: 'tickets', message: '取得票種' });
    input.onProgress({ step: 'lock', message: '保留座位' });
    input.onResult({ status: 'error', message: '座位保留失敗' });
    return { status: 'error' };
  } });
  await service.book({ url: 'https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123' });
  const state = service.getState();
  assert.equal(state.progress.step, 'lock');
  assert.equal(state.progress.status, 'error');
  assert.equal(state.progress.message, '座位保留失敗');
  assert.ok(state.progressLog.every(entry => Number.isFinite(Date.parse(entry.updatedAt))));
  assert.equal(state.progressLog.some(entry => entry.step === 'confirm'), false);
});

test('switching movie resets reserved status and starts watching the new movie', async () => {
  let scan;
  const service = createWatchService({ prepareBooking: async () => null,
    setTimeoutFn: fn => { scan = fn; return 1; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [{ id: 2, movie: '新電影', date: '2026-10-29', availableSeats: 2 }],
    startBooking: async () => ({ status: 'reserved', message: '舊電影已保留' })
  });
  service.start({ movie: '舊電影', date: '2026-10-29' });
  await service.book({ url: 'https://example.com/1' });
  assert.equal(service.getState().bookingActive, true);
  const state = service.start({ movie: '新電影', date: '2026-10-29', autoOpen: false });
  assert.equal(state.bookingActive, false);
  assert.equal(state.bookingStatus, null);
  assert.equal(state.bookingResultStatus, null);
  assert.equal(state.matches.length, 0);
  assert.equal(state.checkedAt, null);
  assert.equal(state.progress.step, 'search');
  assert.equal(state.progressLog.some(p => p.message.includes('舊電影已保留')), false);
  await scan();
  assert.equal(service.getState().matches[0].movie, '新電影');
  service.stop();
});
test('late callbacks from old booking cannot overwrite new movie status or start overlapping bookings', async () => {
  let scan, oldInput, resolveBooking, calls = 0;
  const pending = new Promise(resolve => { resolveBooking = resolve; });
  const service = createWatchService({ prepareBooking: async () => null,
    setTimeoutFn: fn => { scan = fn; return 1; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [{ id: 2, movie: '新電影', date: '2026-10-29', availableSeats: 2 }],
    startBooking: async input => { calls++; oldInput = input; return pending; }
  });
  service.start({ movie: '舊電影', date: '2026-10-29' });
  const oldTask = service.book({ url: 'https://example.com/1' });
  service.start({ movie: '新電影', date: '2026-10-29' });
  await scan();
  assert.equal(calls, 1);
  oldInput.onProgress({ step: 'lock', message: '舊電影進度' });
  oldInput.onStatus('舊電影狀態');
  oldInput.onResult({ status: 'reserved', message: '舊電影成功' });
  resolveBooking({ status: 'reserved', message: '舊電影成功' });
  await oldTask;
  const state = service.getState();
  assert.equal(state.config.movie, '新電影');
  assert.equal(state.bookingActive, false);
  assert.equal(state.bookingResultStatus, null);
  assert.equal(state.progressLog.some(p => /舊電影進度|舊電影狀態|舊電影成功/.test(p.message)), false);
  service.stop();
});

test('preloads before scheduled start without booking and uses same watch scope at booking time', async () => {
  const tasks = [];
  let at = Date.parse('2026-10-28T08:00:00Z'), prepared, booked;
  const session = { id: 123, movie: '鼓手', date: '2026-10-29', availableSeats: 2, url: 'https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123' };
  const service = createWatchService({
    now: () => at, setTimeoutFn: (fn, delay) => { tasks.push({ fn, delay }); return tasks.length; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [session],
    prepareBooking: async input => { prepared = input; return { status: 'prepared', message: '票種已預載' }; },
    startBooking: async input => { booked = input; return { status: 'reserved', message: '成功' }; }
  });
  service.start({ movie: '鼓手', date: '2026-10-29', quantity: 2, startAt: '2026-10-28T08:00:20Z' });
  assert.equal(tasks[0].delay, 12000);
  assert.equal(tasks[1].delay, 20000);
  at += 12000;
  await tasks[0].fn();
  assert.equal(prepared.url, session.url);
  assert.equal(booked, undefined);
  at += 8000;
  await tasks[1].fn();
  assert.equal(booked.watchKey, prepared.watchKey);
  service.stop();
});
test('changing conditions invalidates scheduled preload before it sends an extension command', async () => {
  const tasks = [];
  let preparations = 0;
  const service = createWatchService({
    now: () => Date.parse('2026-10-28T08:00:00Z'),
    setTimeoutFn: fn => { tasks.push(fn); return tasks.length; }, clearTimeoutFn: () => {},
    fetchSessions: async () => [{ movie: '舊電影', date: '2026-10-29' }],
    prepareBooking: async () => { preparations++; }
  });
  service.start({ movie: '舊電影', date: '2026-10-29', startAt: '2026-10-28T08:00:20Z' });
  service.start({ movie: '新電影', date: '2026-10-29', autoOpen: false });
  await tasks[0]();
  assert.equal(preparations, 0);
  service.stop();
});
