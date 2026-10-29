import test from 'node:test';
import assert from 'node:assert/strict';
import '../chrome-extension/seat-planner.js';
const { chooseSeats, createsNewSingleSeat } = globalThis.ShowtimesSeatPlanner;
const row = (name, count, blocked = []) => Array.from({ length: count }, (_, i) => ({ row: name, number: i + 1, x: i * 20, disabled: blocked.includes(i + 1) }));

test('prefers contiguous seats across the whole room', () => {
  const seats = [...row('A', 4), ...row('B', 4, [1, 2, 3, 4])];
  const group = chooseSeats(seats, 2);
  assert.equal(group.length, 2);
  assert.equal(group[0].row, 'A');
  assert.equal(group[1].number, group[0].number + 1);
  assert.equal(createsNewSingleSeat(seats, group), false);
});
test('can combine existing isolated empty seats', () => {
  const seats = [...row('A', 3, [2, 3]), ...row('B', 3, [1, 2])];
  assert.deepEqual(chooseSeats(seats, 2).map(s => s.row).sort(), ['A', 'B']);
});
test('scattered fallback never creates a new isolated empty seat', () => {
  const seats = [...row('A', 2), ...row('B', 2)];
  assert.equal(chooseSeats(seats, 3).length, 0);
  assert.equal(chooseSeats(seats, 2).length, 2);
});
test('one remaining seat allows lower quantity only', () => {
  const seats = row('A', 4, [1, 2, 3]);
  assert.equal(chooseSeats(seats, 2).length, 0);
  assert.equal(chooseSeats(seats, 1)[0].number, 4);
});
test('rejected groups are excluded and fresh availability is respected', () => {
  const seats = row('A', 6);
  const first = chooseSeats(seats, 2);
  const excluded = new Set([first.map(s => `${s.row}:${s.number}`).sort().join('|')]);
  const second = chooseSeats(seats, 2, excluded);
  assert.equal(second.length, 2);
  assert.notDeepEqual(second, first);
  const updated = seats.map(s => ({ ...s, disabled: first.some(t => t.number === s.number) }));
  assert.ok(chooseSeats(updated, 2).every(s => !s.disabled));
});
test('does not join seats across a physical aisle', () => {
  const seats = row('A', 4).map(s => ({ ...s, x: s.x + (s.number > 2 ? 80 : 0) }));
  assert.equal(chooseSeats(seats, 3).length, 0);
});
