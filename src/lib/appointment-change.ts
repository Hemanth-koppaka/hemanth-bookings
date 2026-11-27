import { fmtDate, fmtPrice, fmtTime, type BookingFacts } from './notify/messages';

export type AppointmentChange = {
  id: string;
  event_type: 'BOOKING_PRICE_CHANGED' | 'BOOKING_RESCHEDULED' | 'BOOKING_UPDATED' | 'BOOKING_COMPLETED' | 'NO_SHOW';
  previous: { price?: number; date?: string; time?: number };
};

export function appointmentChangeMessage(event: AppointmentChange, facts: BookingFacts) {
  const when = `${fmtDate(facts.date)}, ${fmtTime(facts.time)}`;
  return {
    title: event.event_type === 'BOOKING_PRICE_CHANGED' ? 'Appointment price updated' : event.event_type === 'BOOKING_RESCHEDULED' ? 'Appointment rescheduled' : event.event_type === 'BOOKING_COMPLETED' ? 'Appointment completed' : event.event_type === 'NO_SHOW' ? 'Appointment marked not attended' : 'Appointment details updated',
    body: event.event_type === 'BOOKING_PRICE_CHANGED'
      ? `${event.previous.price == null ? '' : `${fmtPrice(event.previous.price)} → `}${fmtPrice(facts.price)} · ${when} · Hair by Kiran`
      : event.event_type === 'BOOKING_COMPLETED' ? 'Thank you for visiting Hair by Kiran. Tap to rate your service and share an honest Google review.' : `${event.previous.date && event.previous.time != null ? `Previously ${fmtDate(event.previous.date)}, ${fmtTime(event.previous.time)}. ` : ''}${when}${facts.stylist ? ` · ${facts.stylist}` : ''} · Hair by Kiran`,
    url: `/manage?ref=${encodeURIComponent(facts.reference)}`,
    tag: `appointment-change-${event.id}`,
  };
}