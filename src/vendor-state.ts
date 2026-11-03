import { z, type RefinementCtx } from "zod";

export const MARKET_IDS = [
  "richardson",
  "arlington",
  "castle-hills",
  "plano",
  "carrollton",
  "flower-mound",
] as const;

export type MarketId = (typeof MARKET_IDS)[number];

export const OCCURRENCES: Record<
  MarketId,
  { date: string; fee: number; label: string }
> = {
  richardson: {
    date: "2026-11-07",
    fee: 45,
    label: "Richardson Farmers Market",
  },
  arlington: {
    date: "2026-11-07",
    fee: 45,
    label: "Downtown Arlington Farmers Market",
  },
  "castle-hills": {
    date: "2026-11-07",
    fee: 60,
    label: "Castle Hills Outdoor Market",
  },
  plano: {
    date: "2026-11-07",
    fee: 45,
    label: "Plano Farmers Market",
  },
  carrollton: {
    date: "2026-11-08",
    fee: 45,
    label: "Carrollton Artisans Market",
  },
  "flower-mound": {
    date: "2026-11-08",
    fee: 45,
    label: "Flower Mound Farmers Market",
  },
};

export const MAX_PHOTO_BYTES = 700 * 1024;
export const MAX_WORKSPACE_BYTES = 1_000_000;
export const MAX_PATCH_BODY_BYTES = 1_100_000;

const marketIdSchema = z.enum(MARKET_IDS);
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
    },
    "Use a real calendar date in YYYY-MM-DD format",
  );
const optionalDateSchema = z.union([dateSchema, z.literal("")]);
const urlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an http or https URL");
const photoSchema = z
  .string()
  .max(960_000)
  .superRefine((value, context) => {
    if (!value) return;
    const match = value.match(
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match || match[2].length % 4 !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use a base64-encoded PNG, JPEG, or WebP image",
      });
      return;
    }

    const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
    const decodedBytes = (match[2].length * 3) / 4 - padding;
    if (decodedBytes > MAX_PHOTO_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use an image no larger than 700 KB",
      });
    }
  });

const profileObjectSchema = z
  .object({
    businessName: z.string().trim().max(80).default(""),
    city: z.string().trim().max(80).default(""),
    shortDescription: z.string().trim().max(120).default(""),
    about: z.string().trim().max(350).default(""),
    categories: z
      .array(z.string().trim().min(1).max(50))
      .max(3)
      .default([]),
    website: urlSchema.default(""),
    instagram: urlSchema.default(""),
    photoData: photoSchema.default(""),
    published: z.boolean().default(false),
  })
  .strict();

function validateProfile(
  profile: z.infer<typeof profileObjectSchema>,
  context: RefinementCtx,
) {
  const uniqueCategories = new Set(
    profile.categories.map((category) => category.toLocaleLowerCase()),
  );
  if (uniqueCategories.size !== profile.categories.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["categories"],
      message: "Categories must be unique",
    });
  }
  if (
    profile.published &&
    (!profile.businessName ||
      !profile.shortDescription ||
      profile.categories.length === 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A published profile needs a business name, short description, and at least one category",
    });
  }
}

export const profileSchema = profileObjectSchema.superRefine(validateProfile);

export const reservationSchema = z
  .object({
    id: idSchema,
    marketId: marketIdSchema,
    date: dateSchema,
    boothSize: z.enum(["10x10", "20x10"]),
    estimatedFee: z.number().nonnegative().nullable(),
    quoteNeeded: z.boolean(),
    status: z.enum(["requested", "cancelled"]),
    notes: z.string().trim().max(240),
    createdAt: z.string().datetime(),
  })
  .strict();

const offerObjectSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(150),
    type: z.enum([
      "percentage",
      "amount",
      "bundle",
      "free-item",
      "market-special",
      "new-product",
      "other",
    ]),
    value: z.string().trim().max(60),
    marketIds: z.array(marketIdSchema).max(MARKET_IDS.length),
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    status: z.enum(["draft", "published", "archived"]),
  })
  .strict();

type OfferFields = Omit<z.infer<typeof offerObjectSchema>, "id"> & {
  id?: string;
};

function validateOffer(offer: OfferFields, context: RefinementCtx) {
  if (offer.startDate && offer.endDate && offer.endDate < offer.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date must be on or after start date",
    });
  }
  if (new Set(offer.marketIds).size !== offer.marketIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["marketIds"],
      message: "Markets must be unique",
    });
  }
  if (offer.status === "published") {
    if (!offer.description) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "A published offer needs shopper-facing details",
      });
    }
    if (!offer.startDate || !offer.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [!offer.startDate ? "startDate" : "endDate"],
        message: "A published offer needs a start and end date",
      });
    }
    if (offer.marketIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["marketIds"],
        message: "A published offer needs at least one market",
      });
    }
  }
}

export const offerSchema = offerObjectSchema.superRefine(validateOffer);

export const promotionSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(80),
    headline: z.string().trim().max(80).default(""),
    caption: z.string().trim().min(1).max(600),
    marketId: marketIdSchema,
    reservationId: z.union([idSchema, z.literal("")]),
    offerId: z.union([idSchema, z.literal("")]),
    format: z.enum(["square", "story"]),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const workspaceSchema = z
  .object({
    profile: profileSchema,
    reservations: z.array(reservationSchema).max(100),
    offers: z.array(offerSchema).max(100),
    promotions: z.array(promotionSchema).max(100),
  })
  .strict();

export type VendorWorkspace = z.infer<typeof workspaceSchema>;
export type VendorProfile = z.infer<typeof profileSchema>;
export type VendorReservation = z.infer<typeof reservationSchema>;
export type VendorOffer = z.infer<typeof offerSchema>;
export type VendorPromotion = z.infer<typeof promotionSchema>;

export const emptyWorkspace = (): VendorWorkspace => ({
  profile: {
    businessName: "",
    city: "",
    shortDescription: "",
    about: "",
    categories: [],
    website: "",
    instagram: "",
    photoData: "",
    published: false,
  },
  reservations: [],
  offers: [],
  promotions: [],
});

const reservationRequestSchema = z
  .object({
    marketId: marketIdSchema,
    date: dateSchema,
    boothSize: z.enum(["10x10", "20x10"]),
    notes: z.string().trim().max(240).default(""),
  })
  .strict();

const offerSavePayloadSchema = offerObjectSchema
  .omit({ id: true })
  .extend({ id: idSchema.optional() })
  .strict()
  .superRefine(validateOffer);

const promotionSavePayloadSchema = promotionSchema
  .omit({ id: true, updatedAt: true })
  .extend({ id: idSchema.optional() })
  .strict();

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("profile.save"),
      payload: profileSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reservation.request"),
      payload: reservationRequestSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reservation.cancel"),
      payload: z.object({ id: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("offer.save"),
      payload: offerSavePayloadSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("offer.archive"),
      payload: z.object({ id: idSchema }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("promotion.save"),
      payload: promotionSavePayloadSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("promotion.delete"),
      payload: z.object({ id: idSchema }).strict(),
    })
    .strict(),
]);

export type WorkspaceAction = z.infer<typeof actionSchema>;
export type VersionedWorkspaceAction = WorkspaceAction & { version: number };

const patchEnvelopeSchema = z
  .object({
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    action: z.string(),
    payload: z.unknown(),
  })
  .strict();

export class VendorStateError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "VendorStateError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new VendorStateError(code);
}

export function parseWorkspace(raw: string | null): VendorWorkspace {
  if (raw === null) return emptyWorkspace();
  return workspaceSchema.parse(JSON.parse(raw));
}

export function parsePatchRequest(value: unknown): VersionedWorkspaceAction {
  const envelope = patchEnvelopeSchema.parse(value);
  const action = actionSchema.parse({
    action: envelope.action,
    payload: envelope.payload,
  });
  return { ...action, version: envelope.version } as VersionedWorkspaceAction;
}

export function versionMatches(currentVersion: number, expectedVersion: number) {
  return currentVersion === expectedVersion;
}

export function isAllowedWriteOrigin(
  requestUrl: string,
  origin: string | null,
  secFetchSite: string | null,
) {
  if (secFetchSite?.toLowerCase() === "cross-site" || !origin) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function isOfferActive(offer: VendorOffer, today: string) {
  return (
    offer.status === "published" &&
    offer.startDate <= today &&
    today <= offer.endDate
  );
}

function dateInMarketTimezone(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function applyWorkspaceAction(
  current: VendorWorkspace,
  untrusted: unknown,
  now = new Date(),
): VendorWorkspace {
  const action = actionSchema.parse(untrusted);
  const state = structuredClone(workspaceSchema.parse(current));

  switch (action.action) {
    case "profile.save":
      state.profile = action.payload;
      break;

    case "reservation.request": {
      const occurrence = OCCURRENCES[action.payload.marketId];
      if (occurrence.date !== action.payload.date) {
        fail("occurrence_not_verified");
      }
      if (occurrence.date < dateInMarketTimezone(now)) {
        fail("past_occurrence");
      }
      if (
        state.reservations.some(
          (item) =>
            item.marketId === action.payload.marketId &&
            item.date === action.payload.date &&
            item.status === "requested",
        )
      ) {
        fail("duplicate_reservation_request");
      }
      state.reservations.unshift({
        id: crypto.randomUUID(),
        marketId: action.payload.marketId,
        date: action.payload.date,
        boothSize: action.payload.boothSize,
        estimatedFee:
          action.payload.boothSize === "10x10" ? occurrence.fee : null,
        quoteNeeded: action.payload.boothSize === "20x10",
        status: "requested",
        notes: action.payload.notes,
        createdAt: now.toISOString(),
      });
      break;
    }

    case "reservation.cancel": {
      const item = state.reservations.find(
        (entry) => entry.id === action.payload.id,
      );
      if (!item) fail("reservation_not_found");
      if (item.status === "cancelled") fail("reservation_already_cancelled");
      item.status = "cancelled";
      break;
    }

    case "offer.save": {
      const id = action.payload.id ?? crypto.randomUUID();
      const item = offerSchema.parse({ ...action.payload, id });
      const index = state.offers.findIndex((entry) => entry.id === id);
      if (action.payload.id && index < 0) fail("offer_not_found");
      if (index >= 0) state.offers[index] = item;
      else state.offers.unshift(item);
      break;
    }

    case "offer.archive": {
      const item = state.offers.find((entry) => entry.id === action.payload.id);
      if (!item) fail("offer_not_found");
      if (item.status === "archived") fail("offer_already_archived");
      item.status = "archived";
      break;
    }

    case "promotion.save": {
      const reservation = action.payload.reservationId
        ? state.reservations.find(
            (item) =>
              item.id === action.payload.reservationId &&
              item.status === "requested",
          )
        : null;
      if (action.payload.reservationId && !reservation) {
        fail("reservation_not_found");
      }
      if (reservation && reservation.marketId !== action.payload.marketId) {
        fail("reservation_market_mismatch");
      }

      const offer = action.payload.offerId
        ? state.offers.find(
            (item) =>
              item.id === action.payload.offerId && item.status !== "archived",
          )
        : null;
      if (action.payload.offerId && !offer) fail("offer_not_found");
      if (offer && !offer.marketIds.includes(action.payload.marketId)) {
        fail("offer_market_mismatch");
      }

      const id = action.payload.id ?? crypto.randomUUID();
      const item = promotionSchema.parse({
        ...action.payload,
        id,
        updatedAt: now.toISOString(),
      });
      const index = state.promotions.findIndex((entry) => entry.id === id);
      if (action.payload.id && index < 0) fail("promotion_not_found");
      if (index >= 0) state.promotions[index] = item;
      else state.promotions.unshift(item);
      break;
    }

    case "promotion.delete": {
      const index = state.promotions.findIndex(
        (entry) => entry.id === action.payload.id,
      );
      if (index < 0) fail("promotion_not_found");
      state.promotions.splice(index, 1);
      break;
    }
  }

  const validated = workspaceSchema.parse(state);
  const serializedBytes = new TextEncoder().encode(
    JSON.stringify(validated),
  ).length;
  if (serializedBytes > MAX_WORKSPACE_BYTES) fail("workspace_too_large");
  return validated;
}
