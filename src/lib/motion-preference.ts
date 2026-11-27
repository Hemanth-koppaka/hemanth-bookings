export const MOTION_KEY = "hb-reduced-motion";
export const MOTION_EVENT = "hb-motion-change";

export function prefersLessMotion(saved: string | null, systemReduced: boolean): boolean {
  return systemReduced || saved === "reduce";
}