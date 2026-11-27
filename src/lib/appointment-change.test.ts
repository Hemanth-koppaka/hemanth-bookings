import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { appointmentChangeMessage } from './appointment-change';
import type { BookingFacts } from './notify/messages';

const facts: BookingFacts = { reference:'HB-QACH01', customerName:'Guest', customerPhone:'', date:'2026-11-13', time:540, services:['Signature'], minutes:30, price:700, priceFrom:false, location:'Salon', manageUrl:'' };
test('a 1000 to 700 price change carries the actual changed amounts', () => {
  const message = appointmentChangeMessage({id:'one',event_type:'BOOKING_PRICE_CHANGED',previous:{price:1000}}, facts);
  strictEqual(message.body.includes('₹1,000 → ₹700'), true);
});
test('reschedules carry old and new appointment times', () => {
  const message = appointmentChangeMessage({id:'two',event_type:'BOOKING_RESCHEDULED',previous:{date:'2026-11-12',time:570}}, facts);
  strictEqual(message.body.includes('12 Nov 2026, 9:30 AM'), true);
  strictEqual(message.body.includes('13 Nov 2026, 9:00 AM'), true);
});
test('returning to the same slot remains a distinct notification', () => {
  const one = appointmentChangeMessage({id:'one',event_type:'BOOKING_RESCHEDULED',previous:{}}, facts);
  const two = appointmentChangeMessage({id:'two',event_type:'BOOKING_RESCHEDULED',previous:{}}, facts);
  strictEqual(one.tag === two.tag, false);
});