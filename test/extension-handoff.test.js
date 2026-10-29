import test from 'node:test';
import assert from 'node:assert/strict';
import { publishExtensionCommand, acknowledgeExtensionCommand, getExtensionCommand, waitForExtensionAck } from '../src/extension-handoff.js';
test('returns explicit API reservation result and ignores outdated acknowledgements', async () => {
  const first = publishExtensionCommand('https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123');
  const current = publishExtensionCommand('https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/124');
  acknowledgeExtensionCommand(first.id, { status: 'reserved', message: 'old' });
  assert.equal(getExtensionCommand().acknowledged, false);
  acknowledgeExtensionCommand(current.id, { status: 'reserved', message: '保留成功', accessToken: 'must-not-be-stored' });
  assert.equal(await waitForExtensionAck(current.id), true);
  assert.deepEqual(getExtensionCommand().result, { status: 'reserved', message: '保留成功' });
});
test('does not treat a missing API result as success', () => {
  const command = publishExtensionCommand('https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123');
  acknowledgeExtensionCommand(command.id);
  assert.equal(getExtensionCommand().result.status, 'error');
});

import { updateExtensionProgress } from '../src/extension-handoff.js';
test('delivers actual extension milestones in order, ignoring stale and unsupported progress', async () => {
  const command = publishExtensionCommand('https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/123');
  updateExtensionProgress(command.id - 1, [{ step: 'lock', message: 'stale' }]);
  assert.deepEqual(getExtensionCommand().progress, []);
  updateExtensionProgress(command.id, [{ step: 'tickets', message: '讀取票種' }, { step: 'invalid', message: 'ignore' }, { step: 'lock', message: '保留座位', accessToken: 'not-stored' }]);
  acknowledgeExtensionCommand(command.id, { status: 'error', message: '保留失敗' });
  const received = [];
  await waitForExtensionAck(command.id, 100, progress => received.push(progress));
  assert.deepEqual(received, [{ step: 'tickets', message: '讀取票種' }, { step: 'lock', message: '保留座位' }]);
});
