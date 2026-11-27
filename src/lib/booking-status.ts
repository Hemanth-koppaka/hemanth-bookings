export type BookingStatus = "pending" | "upcoming" | "arrived" | "in-chair" | "completed" | "no-show" | "cancelled";

/** The guest state and salon workflow together determine the displayed state. */
export function bookingStatus(status: unknown, metaStatus: unknown): BookingStatus {
  if (status === "cancelled") return "cancelled";
  switch (metaStatus) {
    case "pending": case "upcoming": case "arrived": case "in-chair":
    case "completed": case "no-show": case "cancelled":
      return metaStatus;
    default:
      return "upcoming";
  }
}