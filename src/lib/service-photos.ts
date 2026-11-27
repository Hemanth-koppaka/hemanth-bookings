// Brand marks and Kiran's portraits. Service and category icons are owned by
// each record (see service-icons.ts): they are never looked up by name here.

const I = (n: string) => `/icons/${n}.webp`;

/** Kiran's Signature mark (HB crown), used for the Signature panel. */
export const SIGNATURE_MARK = I("svc-signature");

/** High-resolution HB crown emblem (uploaded original), used in the Signature panel. */
export const SIGNATURE_EMBLEM_HD = "/brand/hb-emblem.webp";

/** Kiran's portrait (also used wherever the founder is shown on a booking). */
export const KIRAN_PORTRAIT = "/team/kiran-portrait.webp";

/** Full-length portrait shown in the large panel while his Signature is chosen. */
export const KIRAN_FULL = "/team/kiran.webp";

export const isSignature = (s: { name: string }) => /kiran.?s signature/i.test(s.name);
