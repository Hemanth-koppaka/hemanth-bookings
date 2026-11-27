export function firstAvailableSlot(day: { closed: boolean; message?: string; preferred?: { id: string }; slots: { minute: number; available: boolean; staff?: string[] }[] }, staffId?: string | null) {
  if (day.closed || day.message) return null;
  const who = staffId ?? day.preferred?.id;
  return day.slots.find(slot => slot.available && (!who || !slot.staff || slot.staff.includes(who)))?.minute ?? null;
}