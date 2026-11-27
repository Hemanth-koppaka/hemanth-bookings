import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './assistant-commands';
import { MEN_MENU, WOMEN_MENU } from './salon';

// Tuesday 10 November 2026
const ctx = { today: '2026-11-10', menus: { men: MEN_MENU, women: WOMEN_MENU } };
const p = (t: string) => parseCommand(t, ctx) as Record<string, unknown>;
const match = (got: Record<string, unknown>, want: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(want))
    if (v && typeof v === 'object') match(got[k] as Record<string, unknown>, v as Record<string, unknown>);
    else assert.equal(got[k], v, k);
};

test('assistant · reads', () => {
    assert.deepEqual(p('today'), { kind: 'day', date: '2026-11-10' });
    assert.deepEqual(p('bookings on 14 nov'), { kind: 'day', date: '2026-11-14' });
    assert.deepEqual(p('who is at 4 pm tomorrow'), { kind: 'at', date: '2026-11-11', time: 960 });
    match(p('earnings this week'), { kind: 'summary', range: { from: '2026-11-09', to: '2026-11-15' } });
    assert.deepEqual(p('find Ravi'), { kind: 'find', name: 'Ravi' });
  });
test('assistant · book', () => {
    match(p('book Ravi Kumar 9876543210 haircut tomorrow 4 pm'), { kind: 'book', name: 'Ravi Kumar', phone: '9876543210', audience: 'men', date: '2026-11-11', time: 960 });
    match(p('book Priya 98480 12345 cut and styling 12 nov at 11'), { kind: 'book', name: 'Priya', audience: 'women', date: '2026-11-12', time: 660 });
  });
test('assistant · changes', () => {
    assert.deepEqual(p('move Ravi from 4 to 6 tomorrow'), { kind: 'move', who: { name: 'Ravi', time: 960 }, date: '2026-11-11', time: 1080 });
    assert.deepEqual(p('reschedule HB-7KQ2MX to 14 Nov 11 am'), { kind: 'move', who: { ref: 'HB-7KQ2MX' }, date: '2026-11-14', time: 660 });
    assert.deepEqual(p('cancel Ravi tomorrow because unwell'), { kind: 'cancel', who: { name: 'Ravi', date: '2026-11-11' }, reason: 'unwell' });
    assert.deepEqual(p('Ravi arrived'), { kind: 'status', who: { name: 'Ravi' }, status: 'arrived' });
    match(p('Priya didn\'t come'), { kind: 'status', status: 'no-show' });
    assert.deepEqual(p('block 3 pm to 5 pm today for training'), { kind: 'block', date: '2026-11-10', start: 900, end: 1020, reason: 'training' });
    assert.deepEqual(p('close 25 dec for Christmas'), { kind: 'close', dates: ['2026-12-25'], reason: 'Christmas' });
  });

const staffCtx = { ...ctx, staff: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Kiran' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Meera Sharma' }] };
const q = (t: string) => parseCommand(t, staffCtx) as Record<string, unknown>;

test('assistant · casual questions and new actions', () => {
  assert.equal(q('which timings I blocked ?')['kind'], 'blocks');
  assert.equal(q('show blocked times tomorrow')['kind'], 'blocks');
  match(q('unblock 3 pm today'), { kind: 'unblock', date: '2026-11-10', time: 900 });
  match(q('remove the block tmrw'), { kind: 'unblock', date: '2026-11-11' });
  match(q('block tomorrow morning for cleaning'), { kind: 'block', date: '2026-11-11', start: 600, end: 780, reason: 'cleaning' });
  match(q('Kiran off tomorrow'), { kind: 'staffOff', staffName: 'Kiran', start: null });
  match(q('Meera not available friday 2 to 4'), { kind: 'staffOff', staffName: 'Meera Sharma', dates: ['2026-11-13'], start: 840, end: 960 });
  match(q('reopen 25 dec'), { kind: 'reopen', date: '2026-12-25' });
  match(q('change haircut price to 600'), { kind: 'price', price: 600 });
  match(q("Kumar's phone number"), { kind: 'customer', name: 'Kumar' });
  assert.equal(q('what is the weather like in hyderabad today for us')['kind'], 'day');
  assert.equal(q('please do something nice for the salon team')['kind'], 'unknown');
});
