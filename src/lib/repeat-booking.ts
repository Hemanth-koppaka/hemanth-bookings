import { isUpcomingAppointment } from "./upcoming-bookings";
export function isRepeatBooking(booking: { status: string; date: string; time: number; serviceIds: string[]; customer: { phone: string } }, serviceIds: string[], phone: string) {
  return isUpcomingAppointment(booking) && booking.customer.phone.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10) && [...booking.serviceIds].sort().join(",") === [...serviceIds].sort().join(",");
}