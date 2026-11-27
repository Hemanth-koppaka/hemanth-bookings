import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, type Memory } from './assistant-intents';
import { MEN_MENU, WOMEN_MENU } from './salon';

// Tuesday 10 November 2026 (salon time)
const staff = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Kiran' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Meera Sharma' }];
const ctx = (memory?: Memory) => ({ today: '2026-11-10', menus: { men: MEN_MENU, women: WOMEN_MENU }, staff, ...(memory ? { memory } : {}) });
const r = (t: string, m?: Memory) => resolve(t, ctx(m)) as Record<string, any>;
const kind = (t: string, m?: Memory) => r(t, m)['kind'];

test('intents · blocked-time look-ups never become a booking search', () => {
  for (const q of ['Which timings I blocked?', 'which timings I blocked', 'What timings have I blocked?', 'Show my blocked timings.', 'Show my blocked slots.', 'Show all blocked slots.', 'What did I block?', 'Which dates are blocked?', 'Did I block anything for tomorrow?', "What's blocked this weekend?", 'What time is unavailable today?', 'What time slots are unavailable today?']) {
    assert.equal(kind(q), 'unavailable', q);
  }
  const def = r('Which timings I blocked?');
  assert.deepEqual(def['range'], { from: '2026-10-11', to: '2027-01-09', label: 'the last 30 days and the next 60 days' });
  assert.equal(def['defaultRange'], true);
  assert.equal(r('What did I block this week?')['range']['label'], 'this week');
  assert.deepEqual(r("What's blocked this weekend?")['range'], { from: '2026-11-14', to: '2026-11-15', label: 'this weekend' });
  assert.equal(r('Show all salon closures.')['scope'], 'closures');
  assert.equal(r('When is Kiran blocked?')['staff']['name'], 'Kiran');
  assert.equal(r('When is Kiran unavailable?')['staff']['name'], 'Kiran');
  assert.equal(r('When is Meera unavailable?')['staff']['name'], 'Meera Sharma');
  const did = r('Did I block Kiran tomorrow?');
  assert.equal(did['kind'], 'unavailable'); assert.equal(did['range']['from'], '2026-11-11'); assert.equal(did['staff']['name'], 'Kiran');
});

test('intents · availability and staff', () => {
  const a = r('Is Meera available tomorrow?');
  assert.equal(a['kind'], 'available'); assert.equal(a['date'], '2026-11-11'); assert.equal(a['staff']['name'], 'Meera Sharma');
  assert.equal(r('When is Kiran available?')['date'], null);
  assert.equal(kind('Who is working tomorrow?'), 'working');
  assert.equal(r('Show Meera\'s schedule.')['kind'], 'schedule');
  assert.equal(kind('Who is on leave this week?'), 'onLeave');
});

test('intents · creating blocks and closures', () => {
  assert.deepEqual(r('Block Kiran tomorrow from 2 to 4 PM.'), { kind: 'staffBlock', staff: staff[0], date: '2026-11-11', start: 840, end: 960, reason: 'Not available' });
  assert.equal(r('Block the salon on Friday.')['kind'], 'close');
  assert.equal(kind('Keep Meera unavailable from 11 AM to 1 PM.'), 'clarify'); // which day? ask, don't guess
  const aft = r('Block tomorrow afternoon for personal work.');
  assert.equal(aft['kind'], 'block'); assert.equal(aft['start'], 840); assert.equal(aft['end'], 1020); assert.equal(aft['reason'], 'personal work');
  const close = r('Close the salon next Monday for maintenance.');
  assert.equal(close['kind'], 'close'); assert.deepEqual(close['dates'], ['2026-11-16']); assert.equal(close['reason'], 'maintenance');
  assert.equal(kind('Kiran off tomorrow'), 'staffLeave');
  assert.equal(kind('I want to block Kiran tomorrow'), 'clarify');
});

test('intents · removing blocks', () => {
  assert.equal(r("Remove tomorrow's block.")['target']['date'], '2026-11-11');
  const ub = r('Unblock Kiran on Friday.');
  assert.equal(ub['kind'], 'remove'); assert.equal(ub['target']['scope'], 'staff'); assert.equal(ub['target']['date'], '2026-11-13');
  assert.equal(r('Cancel the salon closure.')['target']['scope'], 'closure');
  assert.equal(r('Remove my 2 PM block.')['target']['time'], 840);
  const re = r('Reopen the salon tomorrow.');
  assert.equal(re['target']['scope'], 'closure'); assert.equal(re['target']['date'], '2026-11-11');
  const p = r('Remove the block I created for tomorrow afternoon.');
  assert.equal(p['target']['date'], '2026-11-11'); assert.deepEqual(p['target']['period'], { start: 840, end: 1020, label: 'the afternoon' });
});

test('intents · follow-ups use the conversation memory', () => {
  const list = [{ type: 'block' as const, id: 'b1', label: 'salon Wed 11 Nov' }, { type: 'staffBlock' as const, id: 'b2', staffId: staff[0]!.id, label: 'Kiran' }];
  assert.deepEqual(r('Remove the first one.', { list }), { kind: 'remove', target: { ref: list[0], scope: 'any', staff: null, date: null, time: null, period: null } });
  assert.equal(r('Remove the first block.', { list })['target']['ref']['id'], 'b1');
  assert.equal(r('delete the last one', { list })['target']['ref']['id'], 'b2');
  const sched = { kind: 'schedule' as const, date: '2026-11-11', staff: staff[0]! };
  assert.deepEqual(r('What about Saturday?', { last: sched, staff: staff[0]! }), { kind: 'schedule', date: '2026-11-14', staff: staff[0] });
  assert.deepEqual(r('Block him from 2 to 4', { staff: staff[0]!, date: '2026-11-14' }), { kind: 'staffBlock', staff: staff[0], date: '2026-11-14', start: 840, end: 960, reason: 'Not available' });
  assert.equal(kind('Block him from 2 to 4', { staff: staff[0]! }), 'clarify'); // no day known yet
  assert.equal(r('the whole day', { staff: staff[0]!, date: '2026-11-14', awaiting: 'staffHours' })['kind'], 'staffLeave');
  assert.equal(r('2 to 4', { staff: staff[0]!, date: '2026-11-14', awaiting: 'staffHours' })['start'], 840);
});

test('intents · bookings', () => {
  assert.equal(r('Who is booked today?')['range']['from'], '2026-11-10');
  assert.equal(r("Show tomorrow's appointments.")['range']['from'], '2026-11-11');
  const wk = r('How many bookings do we have this weekend?');
  assert.equal(wk['count'], true); assert.equal(wk['range']['label'], 'this weekend');
  assert.equal(r('Who is coming at 4 PM?')['time'], 960);
  assert.equal(r("Show Kiran's appointments.")['staff']['name'], 'Kiran');
  assert.deepEqual(r("Find Ramesh's next appointment."), { kind: 'nextFor', name: 'Ramesh' });
  assert.deepEqual(r('Cancel booking number 5.'), { kind: 'bookingNo', no: 5, then: 'cancel', reason: '' });
  const mv = r('Reschedule Rahul to 6 PM.');
  assert.equal(mv['kind'], 'move'); assert.equal(mv['who']['name'], 'Rahul'); assert.equal(mv['time'], 1080);
});

test('intents · reports and services', () => {
  assert.deepEqual(r('How much did we earn today?'), { kind: 'report', range: { from: '2026-11-10', to: '2026-11-10', label: 'today' }, metric: 'revenue' });
  assert.equal(r("Show this week's revenue.")['range']['label'], 'this week');
  assert.equal(r('How many appointments were completed?')['metric'], 'completed');
  assert.equal(r('How many customers visited this month?')['metric'], 'customers');
  assert.equal(kind('What is the price of Basic Haircut?'), 'servicePrice');
  const p = r('Change Beard Trim to ₹350.');
  assert.equal(p['kind'], 'price'); assert.equal(p['price'], 350);
  assert.deepEqual(r('Which services are inactive?'), { kind: 'serviceList', active: false });
  assert.deepEqual(r('Show all active services.'), { kind: 'serviceList', active: true });
});

test('intents · navigation and dates', () => {
  assert.equal(r('Open my calendar.')['page'], 'calendar');
  assert.equal(r("Take me to today's appointments.")['page'], 'appointments');
  assert.equal(r('Open customer details for Rahul.')['name'], 'Rahul');
  assert.equal(r('Show activity history.')['page'], 'activity');
  assert.equal(r('Open revenue report.')['page'], 'reports');
  assert.equal(r('Who is booked on 12/11/2026?')['range']['from'], '2026-11-12');
  assert.equal(r('Who is booked next week?')['range']['from'], '2026-11-16');
  assert.equal(r('Block 4 June 2027 between 2 and 4 for training')['start'], 840);
});

test('intents · "booking number N" never picks item N of the last list', () => {
  const list = [{ type: 'closure' as const, id: 'c1', label: 'closure' }, { type: 'block' as const, id: 'b1', label: 'block' }];
  assert.deepEqual(r('Cancel booking number 1.', { list }), { kind: 'bookingNo', no: 1, then: 'cancel', reason: '' });
  assert.deepEqual(r('cancel appointment #2', { list }), { kind: 'bookingNo', no: 2, then: 'cancel', reason: '' });
  assert.equal(r('remove number 2', { list })['target']['ref']['id'], 'b1');
});
