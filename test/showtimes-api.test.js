import assert from "node:assert/strict";import test from"node:test";import{normalizeDate,parseBootstrap}from"../src/showtimes-api.js";
test("normalizes dates",()=>{assert.equal(normalizeDate("8/31"),`${new Date().getFullYear()}-08-31`);assert.equal(normalizeDate("2026-9-6"),"2026-09-06");assert.equal(normalizeDate("x"),null)});
test("joins special events with programs and cinemas",()=>{const sessions=parseBootstrap({programs:[{id:1,name:"粉絲場",meta:{isSpecial:true}}],corporations:[{id:2,name:"大巨蛋秀泰"}],events:[{id:3,programId:1,corporationId:2,startedAt:"2026-09-06T10:00:00+08:00",meta:{format:"2D"}}]});assert.equal(sessions.length,1);assert.equal(sessions[0].movie,"粉絲場");assert.equal(sessions[0].cinema,"大巨蛋秀泰");assert.match(sessions[0].url,/\/3$/)});
test("flattens corporation event groups",()=>{const sessions=parseBootstrap({programs:[{id:1,name:"特別場",meta:{isSpecial:true}}],corporations:[{id:2,name:"站前秀泰"}],eventsForCorporations:{2:{events:[{id:8,programId:1,corporationId:2,venueId:9,startedAt:"2026-09-06T02:00:00.000Z"}],venues:[{id:9,name:"一廳"}]}}});assert.equal(sessions[0].room,"一廳");assert.equal(sessions[0].time,"10:00")});

import { fetchSpecialSessions, parseSeatsAvailability } from "../src/showtimes-api.js";
test("joins live availability by event ID and preserves sold-out and unknown counts", async () => {
  const urls = [];
  const sessions = await fetchSpecialSessions(async (url, options) => {
    urls.push(url);
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ msg: "ok", payload: url.endsWith("bootstrap") ? {
      programs: [{ id: 13084, name: "泥面人 特別場", meta: { isSpecial: true } }],
      events: [1, 2, 3].map(id => ({ id, programId: 13084, startedAt: "2026-10-29T12:00:00Z" }))
    } : { seatsAvailability: { 1: 2, 2: 0 } } }) };
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.some(url => url.endsWith("/events/seatsAvailability")));
  assert.deepEqual(sessions.map(s => s.availableSeats), [2, 0, null]);
  assert.equal(sessions[0].programId, 13084);
});
test("rejects malformed availability and excludes invalid counts", () => {
  assert.throws(() => parseSeatsAvailability({ payload: {} }), /格式/);
  assert.deepEqual(parseSeatsAvailability({ payload: { seatsAvailability: { 1: 0, 2: "2", 3: -1, 4: null, 5: 2 } } }), { 1: 0, 5: 2 });
});
test("fails scan when availability API fails", async () => {
  await assert.rejects(fetchSpecialSessions(async url => ({ ok: !url.endsWith("seatsAvailability"), status: 503, json: async () => ({ payload: {} }) })), /503/);
});

test('keeps scan context briefly for booking without exposing it on every session row', async () => {
  const { getRecentSessionContext } = await import('../src/showtimes-api.js');
  const sessions = await fetchSpecialSessions(async url => ({ ok: true, json: async () => ({ payload: url.endsWith('bootstrap') ? {
    programs: [{ id: 1, name: '特別場', meta: { isSpecial: true } }], corporations: [{ id: 91, name: '大巨蛋' }],
    events: [{ id: 123, programId: 1, corporationId: 91, status: 'active', startedAt: '2026-10-29T20:00:00Z' }]
  } : { seatsAvailability: { 123: 4 } } }) }));
  const context = getRecentSessionContext(123);
  assert.equal(context.event.id, 123);
  assert.equal(context.program.id, 1);
  assert.equal(context.corporation.id, 91);
  assert.equal(getRecentSessionContext(123, context.fetchedAt + 10_000), undefined);
  assert.equal(getRecentSessionContext(124), undefined);
  assert.equal(sessions[0].sessionContext, undefined);
});
