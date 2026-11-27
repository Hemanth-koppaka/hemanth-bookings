export const MOTION_KEY = "bk-reduced-motion";
export const MOTION_EVENT = "bk-motion-change";

export function prefersLessMotion(saved: string | null, systemReduced: boolean): boolean {
  return systemReduced || saved === "reduce";
}
