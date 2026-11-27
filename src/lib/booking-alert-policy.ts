const bookingEvents = new Set(["BOOKING_CONFIRMED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED", "BOOKING_PRICE_CHANGED", "BOOKING_UPDATED", "BOOKING_COMPLETED", "NO_SHOW"]);
export function isBookingAlert(event: string) { return bookingEvents.has(event); }
export function receivesBookingAlert(subscription: { staffId?: string }, staffId?: string | null, staffOnly = false) {
  return subscription.staffId ? Boolean(staffId) && subscription.staffId === staffId : !staffOnly;
}