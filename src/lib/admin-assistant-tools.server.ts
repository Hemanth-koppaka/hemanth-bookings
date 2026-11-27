// Explicit allowlist. Schemas mirror existing server-action validators.
import { z } from 'zod';
import { toE164, isE164 } from './notify/messages';
import { adminListBookings, adminUpsertBooking, adminSaveBusinessHours, adminSaveConfig } from './salon.functions';
import { adminDashboard, adminDay, adminRange, adminBookings, adminBooking, adminAvailability, adminCustomers, adminCustomer, adminSaveCustomer, adminAnalytics, adminExportCsv } from './admin-data.functions';
import { adminListBlocks, adminSaveBlock, adminArchiveBlock, adminGetRules, adminSaveRules, adminActivity } from './admin-ops.functions';
import { adminStaffList, adminSaveStaff, adminAddLeave, adminAddStaffBlock, adminRemoveStaffTime, adminClosures, adminAddClosure, adminReopen, adminServiceRule, adminSetServiceRule } from './admin-staff.functions';
import { adminCatalogue, adminArchiveItem, adminReorder, adminDuplicateService, adminGetSite, adminSaveSiteDraft, adminPublishSite, adminDiscardSiteDraft } from './admin-catalogue.functions';
import { adminGetContent, adminSaveCategory, adminSaveService, adminSaveHours, adminSaveException, adminSaveBusiness, adminSaveSound } from './admin-content.functions';
import { adminNotifySettings, adminSaveNotifySettings, adminSendTestMessage, adminNotificationLogs, adminRetryNotification, adminDispatchNow } from './admin-notify.functions';
import { adminSystemHealth } from './admin-system.functions';
import { adminReferencePhotos } from './photos.functions';

export type AssistantTool = { name: string; read: boolean; schema: z.ZodType; execute: (pin: string, args: unknown) => Promise<unknown> };
export function assistantTools(): AssistantTool[] {
 const tools: AssistantTool[] = [];
 function add<S extends z.ZodType>(name: string, read: boolean, schema: S, execute: (pin: string, args: z.output<S>) => Promise<unknown>) { tools.push({name, read, schema, execute: (pin,args) => execute(pin,schema.parse({...Object(args),pin}))}); }
 {
 const pinOnly = z.object({ pin: z.string().max(512) });
 const hhmmTime = z.string().regex(/^\d{2}:\d{2}$/);
 const businessHourInput = z.object({
  day: z.number().int().min(0).max(6),
  open: z.boolean(),
  from: hhmmTime,
  to: hhmmTime,
  breaks: z.array(z.object({ start: hhmmTime, end: hhmmTime })).max(6),
});
 const bookingInput = z.object({ reference: z.string(), audience:z.enum(['men','women']), serviceIds:z.array(z.string().max(80)).min(1).max(20), date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time:z.number().int().min(0).max(1440), customer:z.object({name:z.string().trim().min(1).max(100),phone:z.string().min(7).max(20),email:z.string().max(255),notes:z.string().max(1000).optional()}), staffId:z.string().uuid().optional() });
 add('adminListBookings', true, (pinOnly), async (pin,args) => adminListBookings({data:{...args,pin}}));
 add('adminUpsertBooking', false, (pinOnly
      .extend({
        reference: z.string().max(20),
        insert: bookingInput
          .omit({ reference: true })
          .extend({ source: z.enum(["online", "walk-in", "phone", "whatsapp", "admin"]) })
          .optional(),
        patch: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            time: z.number().int().min(0).max(1440).optional(),
            status: z.enum(["confirmed", "cancelled"]).optional(),
            meta: z.object({status:z.enum(['pending','upcoming','arrived','in-chair','completed','no-show','cancelled']).optional(), payment:z.enum(['cash','upi','card','unpaid']).optional(), amount:z.number().min(0).max(1000000).nullable().optional(),note:z.string().max(2000).optional()}).strict().optional(),
            cancelReason: z.string().max(200).optional(),
            customer: z
              .object({
                name: z.string().trim().min(1).max(100),
                phone: z.string().trim().max(20),
                email: z.string().trim().max(255),
              })
              .optional(),
            /** reassign to a stylist ("any" = whoever is free) */
            staffId: z.union([z.string().uuid(), z.literal("any")]).optional(),
          })
          .optional(),
      })), async (pin,args) => adminUpsertBooking({data:{...args,pin}}));
 add('adminSaveBusinessHours', false, (pinOnly.extend({ hours: z.array(businessHourInput).length(7) })), async (pin,args) => adminSaveBusinessHours({data:{...args,pin}}));
 add('adminSaveConfig', false, (pinOnly
      .extend({
        config: z
          .object({
            accepting: z.boolean().optional(),
            staff: z
              .array(
                z
                  .object({
                    id: z.string().trim().min(1).max(80),
                    name: z.string().trim().min(1).max(80),
                    role: z.string().trim().min(1).max(80),
                    active: z.boolean(),
                  })
                  .strict(),
              )
              .max(30)
              .optional(),
          })
          .strict()
          .refine((config) => config.accepting !== undefined || config.staff !== undefined),
      })), async (pin,args) => adminSaveConfig({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
 add('adminDashboard', true, (z.object({ pin })), async (pin,args) => adminDashboard({data:{...args,pin}}));
 add('adminDay', true, (z.object({ pin, date: isoDate })), async (pin,args) => adminDay({data:{...args,pin}}));
 add('adminRange', true, (z.object({ pin, from: isoDate, to: isoDate })), async (pin,args) => adminRange({data:{...args,pin}}));
 add('adminBookings', true, (z
      .object({
        pin,
        from: isoDate.optional(),
        to: isoDate.optional(),
        status: z.string().max(20).optional(),
        source: z.string().max(20).optional(),
        q: z.string().max(80).optional(),
        page: z.number().int().min(0).max(1000).default(0),
      })), async (pin,args) => adminBookings({data:{...args,pin}}));
 add('adminBooking', true, (z.object({ pin, reference: z.string().max(20) })), async (pin,args) => adminBooking({data:{...args,pin}}));
 add('adminAvailability', true, (z
      .object({
        pin,
        date: isoDate,
        audience: z.enum(["men", "women"]),
        serviceIds: z.array(z.string().max(80)).max(20),
        reference: z.string().max(20).optional(),
        /** a stylist id, or "any" */
        staffId: z.string().max(40).optional(),
      })), async (pin,args) => adminAvailability({data:{...args,pin}}));
 add('adminCustomers', true, (z
      .object({
        pin,
        q: z.string().max(80).optional(),
        audience: z.enum(["all", "men", "women"]).default("all"),
        page: z.number().int().min(0).max(1000).default(0),
      })), async (pin,args) => adminCustomers({data:{...args,pin}}));
 add('adminCustomer', true, (z.object({ pin, id: z.string().uuid() })), async (pin,args) => adminCustomer({data:{...args,pin}}));
 add('adminSaveCustomer', false, (z
      .object({
        pin,
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().max(20),
        email: z.string().trim().max(255),
        notes: z.string().max(2000),
      })), async (pin,args) => adminSaveCustomer({data:{...args,pin}}));
 add('adminAnalytics', true, (z.object({ pin, from: isoDate, to: isoDate })), async (pin,args) => adminAnalytics({data:{...args,pin}}));
 add('adminExportCsv', true, (z
      .object({
        pin,
        kind: z.enum(["bookings", "customers"]),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })), async (pin,args) => adminExportCsv({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
 const minute = z.number().int().min(0).max(1440);
 const rulesInput = z.object({
  slotInterval: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
  minNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 1440),
  maxAdvanceDays: z.number().int().min(1).max(365),
  allowSameDay: z.boolean(),
  allowMultiple: z.boolean(),
  maxServices: z.number().int().min(1).max(20),
  customerCancel: z.boolean(),
  cancelDeadlineMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 1440),
  customerReschedule: z.boolean(),
  rescheduleDeadlineMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 1440),
  maxReschedules: z.number().int().min(0).max(10),
  accepting: z.boolean(),
  pauseMessage: z.string().trim().min(1).max(240),
});
 add('adminListBlocks', true, (z.object({ pin, from: isoDate, to: isoDate, includeArchived: z.boolean().optional() })), async (pin,args) => adminListBlocks({data:{...args,pin}}));
 add('adminSaveBlock', false, (z
      .object({
        pin,
        id: z.string().uuid().optional(),
        date: isoDate,
        start: minute,
        end: minute,
        kind: z.enum(["block", "break"]),
        reason: z.string().trim().max(120),
        confirm: z.boolean().optional(),
      })
      .refine((v) => v.end > v.start, "End must be after start")), async (pin,args) => adminSaveBlock({data:{...args,pin}}));
 add('adminArchiveBlock', false, (z.object({ pin, id: z.string().uuid(), restore: z.boolean().optional() })), async (pin,args) => adminArchiveBlock({data:{...args,pin}}));
 add('adminGetRules', true, (z.object({ pin })), async (pin,args) => adminGetRules({data:{...args,pin}}));
 add('adminSaveRules', false, (z.object({ pin, rules: rulesInput })), async (pin,args) => adminSaveRules({data:{...args,pin}}));
 add('adminActivity', true, (z
      .object({
        pin,
        before: z.number().int().optional(),
        entity: z.string().max(40).optional(),
        q: z.string().max(80).optional(),
      })), async (pin,args) => adminActivity({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const minute = z.number().int().min(0).max(1440);
 const label = (m: number) =>
  `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
 const staffInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  gender: z.enum(["", "male", "female", "other"]),
  specialties: z.string().trim().max(160),
  active: z.boolean(),
  bookable: z.boolean(),
  order: z.number().int().min(0).max(999),
  services: z.array(z.string().max(80)).max(400),
  hours: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        working: z.boolean(),
        start: minute,
        end: minute,
      }),
    )
    .length(7)
    .refine(
      (h) => h.every((x) => !x.working || x.end > x.start),
      "Each working day must end after it starts",
    ),
  breaks: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6).nullable(),
        start: minute,
        end: minute,
        label: z.string().trim().max(40),
      }),
    )
    .max(20)
    .refine((b) => b.every((x) => x.end > x.start), "Each break must end after it starts"),
});
 const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
 add('adminStaffList', true, (z.object({ pin })), async (pin,args) => adminStaffList({data:{...args,pin}}));
 add('adminSaveStaff', false, (z.object({ pin, staff: staffInput })), async (pin,args) => adminSaveStaff({data:{...args,pin}}));
 add('adminAddLeave', false, (z
      .object({
        pin,
        staffId: z.string().uuid(),
        start: isoDate,
        end: isoDate,
        reason: z.string().trim().max(120),
        confirm: z.boolean().optional(),
      })
      .refine((v) => v.end >= v.start, "Leave must end on or after its start")), async (pin,args) => adminAddLeave({data:{...args,pin}}));
 add('adminAddStaffBlock', false, (z
      .object({
        pin,
        staffId: z.string().uuid(),
        date: isoDate,
        start: minute,
        end: minute,
        reason: z.string().trim().max(120),
        confirm: z.boolean().optional(),
      })
      .refine((v) => v.end > v.start, "End must be after start")), async (pin,args) => adminAddStaffBlock({data:{...args,pin}}));
 add('adminRemoveStaffTime', false, (z.object({ pin, kind: z.enum(["leave", "block"]), id: z.string().uuid() })), async (pin,args) => adminRemoveStaffTime({data:{...args,pin}}));
 add('adminClosures', true, (z.object({ pin })), async (pin,args) => adminClosures({data:{...args,pin}}));
 add('adminAddClosure', false, (z
      .object({
        pin,
        kind: z.enum(["days", "open", "hours", "dates"]),
        start: isoDate.optional(),
        end: isoDate.optional(),
        dates: z.array(isoDate).max(60).optional(),
        startMinute: minute.optional(),
        endMinute: minute.optional(),
        reason: z.string().trim().max(120),
      })), async (pin,args) => adminAddClosure({data:{...args,pin}}));
 add('adminReopen', false, (z.object({ pin, id: z.string().uuid() })), async (pin,args) => adminReopen({data:{...args,pin}}));
 add('adminServiceRule', true, (z.object({ pin, id: z.string().max(80) })), async (pin,args) => adminServiceRule({data:{...args,pin}}));
 add('adminSetServiceRule', false, (z
      .object({
        pin,
        id: z.string().max(80),
        preferred: z.union([z.literal("any"), z.string().max(80)]),
      })), async (pin,args) => adminSetServiceRule({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const text = (max: number) => z.string().max(max);
 const contentInput = z.object({
  announcement: z.object({ enabled: z.boolean(), text: text(200) }),
  home: z.object({
    headline: text(40),
    headlineAccent: text(40),
    intro: text(200),
    introLong: text(320),
    ctaLabel: text(32),
  }),
  policies: z.object({ changes: text(240), payment: text(160), lateness: text(240) }),
});
 add('adminCatalogue', true, (z.object({ pin })), async (pin,args) => adminCatalogue({data:{...args,pin}}));
 add('adminArchiveItem', false, (z
      .object({
        pin,
        kind: z.enum(["service", "category"]),
        id: z.string().max(80),
        restore: z.boolean().optional(),
      })), async (pin,args) => adminArchiveItem({data:{...args,pin}}));
 add('adminReorder', false, (z
      .object({
        pin,
        kind: z.enum(["service", "category"]),
        ids: z.array(z.string().max(80)).min(1).max(200),
      })), async (pin,args) => adminReorder({data:{...args,pin}}));
 add('adminDuplicateService', false, (z.object({ pin, id: z.string().max(80) })), async (pin,args) => adminDuplicateService({data:{...args,pin}}));
 add('adminGetSite', true, (z.object({ pin })), async (pin,args) => adminGetSite({data:{...args,pin}}));
 add('adminSaveSiteDraft', false, (z.object({ pin, content: contentInput })), async (pin,args) => adminSaveSiteDraft({data:{...args,pin}}));
 add('adminPublishSite', false, (z.object({ pin, content: contentInput })), async (pin,args) => adminPublishSite({data:{...args,pin}}));
 add('adminDiscardSiteDraft', false, (z.object({ pin })), async (pin,args) => adminDiscardSiteDraft({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const gender = z.enum(["men", "women"]);
 const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
 add('adminGetContent', true, (z.object({ pin })), async (pin,args) => adminGetContent({data:{...args,pin}}));
 add('adminSaveCategory', false, (z
      .object({
        pin,
        id: z.string().max(60).optional(),
        gender,
        name: z.string().trim().min(1).max(80),
        description: z.string().max(400),
        order: z.number().int().min(0).max(999),
        active: z.boolean(),
      })), async (pin,args) => adminSaveCategory({data:{...args,pin}}));
 add('adminSaveService', false, (z
      .object({
        pin,
        id: z.string().max(80).optional(),
        categoryId: z.string().max(60),
        name: z.string().trim().min(1).max(120),
        description: z.string().max(1000),
        minutes: z.number().int().min(5).max(600).multipleOf(5),
        price: z.number().int().min(0).max(1_000_000),
        from: z.boolean(),
        order: z.number().int().min(0).max(999),
        active: z.boolean(),
        buffer: z.number().int().min(0).max(120).optional(),
        featured: z.boolean().optional(),
      })), async (pin,args) => adminSaveService({data:{...args,pin}}));
 add('adminSaveHours', false, (z
      .object({
        pin,
        hours: z
          .array(
            z.object({
              day: z.number().int().min(0).max(6),
              open: z.boolean(),
              from: time,
              to: time,
            }),
          )
          .length(7),
      })), async (pin,args) => adminSaveHours({data:{...args,pin}}));
 add('adminSaveException', false, (z
      .object({
        pin,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        remove: z.boolean().optional(),
        open: z.boolean(),
        from: time.nullable(),
        to: time.nullable(),
        note: z.string().max(200),
      })), async (pin,args) => adminSaveException({data:{...args,pin}}));
 add('adminSaveBusiness', false, (z
      .object({
        pin,
        business: z
          .object({
            brand: z.string().trim().min(1).max(80),
            name: z.string().trim().min(1).max(120),
            tagline: z.string().max(120),
            locationShort: z.string().max(160),
            address: z.string().max(400),
            mapsQuery: z.string().max(400),
            phones: z.array(z.string().trim().max(20)).max(4),
            facilities: z.array(z.string().trim().max(80)).max(20),
            lastSlot: z.string().max(60),
          })
          .partial(),
      })), async (pin,args) => adminSaveBusiness({data:{...args,pin}}));
 add('adminSaveSound', false, (z
      .object({
        pin,
        sound: z.object({
          enabled: z.boolean(),
          volume: z.number().min(0).max(1),
          preset: z.enum(["luxury", "minimal", "silent"]),
        }),
      })), async (pin,args) => adminSaveSound({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 const phone = z
  .string()
  .trim()
  .max(20)
  .transform((p) => (p ? toE164(p) || "INVALID" : ""))
  .refine((p) => p === "" || isE164(p), "Enter a valid mobile number, e.g. +91 98765 43210");
 const settingsInput = z.object({
  provider: z.enum(["msg91"]),
  customerWhatsapp: z.boolean(),
  customerSms: z.boolean(),
  adminWhatsapp: z.boolean(),
  adminSms: z.boolean(),
  fallback: z.boolean(),
  customerConfirmation: z.boolean(),
  customerUpdates: z.boolean(),
  adminNewBooking: z.boolean(),
  adminUpdates: z.boolean(),
  reminder24h: z.boolean(),
  reminder2h: z.boolean(),
  adminPhone: phone,
  testPhone: phone,
  publicSiteUrl: z
    .string()
    .trim()
    .max(200)
    .refine(
      (u) => u === "" || /^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(u),
      "Use the full address, e.g. https://salon.example.com",
    ),
  customerEmail: z.boolean(),
  adminEmail: z.boolean(),
  adminEmailAddress: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid salon email"),
  email: z.object({
    provider: z.enum(["brevo", "resend"]),
    from: z
      .string()
      .trim()
      .max(200)
      .refine(
        (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "Enter a valid sender email",
      ),
    fromName: z.string().trim().max(80),
  }),
  providerConfig: z.object({
    whatsappNumber: phone.optional(),
    whatsappLanguage: z.string().trim().max(10).optional(),
    whatsappNamespace: z.string().trim().max(80).optional(),
    smsVarPrefix: z
      .string()
      .trim()
      .max(12)
      .regex(/^[A-Za-z_]*$/)
      .optional(),
    templates: z
      .record(
        z.string().max(60),
        z.object({
          whatsapp: z.string().trim().max(120).optional(),
          sms: z.string().trim().max(60).optional(),
        }),
      )
      .optional(),
  }),
});
 add('adminNotifySettings', true, (z.object({ pin })), async (pin,args) => adminNotifySettings({data:{...args,pin}}));
 add('adminSaveNotifySettings', false, (z.object({ pin, settings: settingsInput })), async (pin,args) => adminSaveNotifySettings({data:{...args,pin}}));
 add('adminSendTestMessage', false, (z
      .object({
        pin,
        kind: z.enum(["customer", "admin"]),
        channel: z.enum(["whatsapp", "sms", "email"]),
      })), async (pin,args) => adminSendTestMessage({data:{...args,pin}}));
 add('adminNotificationLogs', true, (z
      .object({
        pin,
        bookingId: z.string().max(20).optional(),
        problems: z.boolean().optional(),
        page: z.number().int().min(0).max(500).default(0),
      })), async (pin,args) => adminNotificationLogs({data:{...args,pin}}));
 add('adminRetryNotification', false, (z.object({ pin, id: z.number().int().positive() })), async (pin,args) => adminRetryNotification({data:{...args,pin}}));
 add('adminDispatchNow', false, (z.object({ pin })), async (pin,args) => adminDispatchNow({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 add('adminSystemHealth', true, (z.object({ pin })), async (pin,args) => adminSystemHealth({data:{...args,pin}}));
 }
 {
 const pin = z.string().max(512);
 add('adminReferencePhotos', true, (z.object({ pin, reference: z.string().max(20) })), async (pin,args) => adminReferencePhotos({data:{...args,pin}}));
 }
 return tools;
}
