import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { bookingSnapshot } from './booking-snapshot';

test('unfinished booking displays the updated 700 amount rather than the original 1000', () => {
  strictEqual(bookingSnapshot({ price_total: 700, duration_minutes: 30, services_snapshot: [{ id: 'm-signature', name: "Kiran's Signature", price: 700, minutes: 30 }] })?.price, 700);
});
test('completed booking displays its retained recorded 1000 amount', () => {
  strictEqual(bookingSnapshot({ meta: { status: 'completed' }, price_total: 1000, services_snapshot: [{ price: 1000, name: "Kiran's Signature", minutes: 30 }] })?.price, 1000);
});