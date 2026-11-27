type Appointment = { status: string; date: string; time: number };

/** Appointment starts are compared in the salon's Asia/Kolkata timezone. */
export function isUpcomingAppointment(booking: Appointment, now = new Date()) {
  if (booking.status !== "confirmed") return false;
  const salon = new Date(now.getTime() + 330 * 60_000);
  const today = salon.toISOString().slice(0, 10);
  const minute = salon.getUTCHours() * 60 + salon.getUTCMinutes();
  return booking.date > today || (booking.date === today && booking.time >= minute);
}