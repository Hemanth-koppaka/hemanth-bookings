import { supabaseAdmin as sb } from '@/integrations/supabase/client.server';
import { appointmentChangeMessage, type AppointmentChange } from './appointment-change';
import { deliverToGuest, pushBookingEvent } from './push.server';
import { factsFromBooking, notifyBookingEvent } from './notify/service.server';

type EventRow = AppointmentChange & { booking_reference: string; booking_snapshot: Record<string, unknown> };
type Sub = Parameters<typeof deliverToGuest>[0];

/** Committed database events cover catalogue changes and every rescheduling path. */
export async function dispatchAppointmentChanges(reference?: string) {
  let query = sb.from('appointment_change_events').select('*').is('processed_at', null).order('created_at').limit(30);
  if (reference) query = query.eq('booking_reference', reference);
  const { data: events, error } = await query;
  if (error) throw new Error('Could not read appointment change alerts');
  for (const event of (events ?? []) as unknown as EventRow[]) {
    const snapshot = event.booking_snapshot;
    const meta = (snapshot['meta'] ?? {}) as { push?: Sub[] };
    if (meta.push?.length) {
      const { error: insertError } = await sb.from('appointment_change_deliveries').upsert(meta.push.map(subscription => ({event_id:event.id, subscription:subscription as never})), {onConflict:'event_id,subscription',ignoreDuplicates:true});
      if (insertError) throw new Error('Could not queue appointment change alerts');
    }
    await notifyBookingEvent(event.booking_reference, event.event_type, {
      actor:'admin', occurrence:event.id, snapshot,
      previousPrice:event.previous.price,
      previous:event.previous.date && event.previous.time != null ? {date:event.previous.date,time:event.previous.time} : undefined,
    });
    await pushBookingEvent(event.booking_reference, event.event_type, { snapshot, staffOnly: true });
    await sb.from('appointment_change_events').update({processed_at:new Date().toISOString()}).eq('id',event.id);
  }
  const { data: deliveries, error: claimError } = await sb.rpc('claim_appointment_change_deliveries');
  if (claimError) throw new Error('Could not claim appointment change alerts');
  let sent = 0;
  for (const delivery of deliveries ?? []) {
    const { data: event } = await sb.from('appointment_change_events').select('*').eq('id',delivery.event_id).maybeSingle();
    if (!event) continue;
    const e = event as unknown as EventRow;
    const facts = factsFromBooking(e.booking_snapshot,{location:'Hair by Kiran',siteUrl:''});
    const outcome = await deliverToGuest(delivery.subscription as unknown as Sub, appointmentChangeMessage(e, facts));
    const { error: saveError } = await sb.from('appointment_change_deliveries').update({
      status:outcome === 'sent' ? 'sent' : outcome === 'gone' ? 'gone' : 'pending',
      next_attempt_at:new Date(Date.now()+Math.min(60,5*2**Math.min(delivery.attempts,4))*60_000).toISOString(),
      claimed_until:null,
    }).eq('id',delivery.id).eq('attempts',delivery.attempts);
    if (saveError) throw new Error('Could not save appointment alert delivery');
    if (outcome === 'sent') sent++;
  }
  return {captured:events?.length ?? 0,sent};
}

/** Only call after the caller has proved ownership of the booking. */
export async function customerAppointmentChanges(reference: string) {
  const { data } = await sb.from('appointment_change_events').select('id,event_type,previous,booking_snapshot,created_at').eq('booking_reference',reference).order('created_at',{ascending:false}).limit(3);
  return (data ?? []).map(event => {
    const e = event as unknown as EventRow;
    const facts = factsFromBooking(e.booking_snapshot,{location:'Hair by Kiran',siteUrl:''});
    return {id:e.id,...appointmentChangeMessage(e,facts)};
  });
}