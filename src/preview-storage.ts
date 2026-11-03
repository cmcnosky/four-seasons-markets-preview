import { z } from "zod";

import {
  MAX_PATCH_BODY_BYTES,
  VendorStateError,
  applyWorkspaceAction,
  emptyWorkspace,
  isOfferActive,
  parsePatchRequest,
  workspaceSchema,
} from "./vendor-state.ts";

export const STORAGE_PREFIX = "fsm-github-preview-v1";
export const STORAGE_KEY = `${STORAGE_PREFIX}:workspace`;
export const LOCAL_PROFILE_ID = "browser-local";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type RequestOptions = { method?: string; body?: unknown };

export type PreviewResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type PreviewApi = {
  request(url: string | URL, options?: RequestOptions): Promise<PreviewResponse>;
};

type PreviewOptions = {
  getStorage?: () => StorageLike;
  now?: () => Date;
};

const storedSchema = z
  .object({
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: workspaceSchema,
  })
  .strict();

type StoredWorkspace = z.infer<typeof storedSchema>;

class LocalStoreError extends Error {
  readonly kind: "unavailable" | "corrupt" | "full";

  constructor(kind: "unavailable" | "corrupt" | "full") {
    super(kind);
    this.name = "LocalStoreError";
    this.kind = kind;
  }
}

const DOMAIN_ERRORS: Record<string, { status: number; message: string }> = {
  duplicate_reservation_request: {
    status: 409,
    message: "A request for this market occurrence is already active.",
  },
  reservation_already_cancelled: {
    status: 409,
    message: "That reservation request is already cancelled.",
  },
  offer_already_archived: {
    status: 409,
    message: "That offer is already archived.",
  },
  reservation_not_found: {
    status: 404,
    message: "That reservation request is no longer available.",
  },
  offer_not_found: {
    status: 404,
    message: "That offer is no longer available.",
  },
  promotion_not_found: {
    status: 404,
    message: "That saved promotion is no longer available.",
  },
  occurrence_not_verified: {
    status: 422,
    message: "That market and date are not a verified occurrence in this preview.",
  },
  past_occurrence: {
    status: 422,
    message: "That market occurrence has already passed.",
  },
  reservation_market_mismatch: {
    status: 422,
    message: "The selected reservation belongs to a different market.",
  },
  offer_market_mismatch: {
    status: 422,
    message: "The featured offer is not associated with the selected market.",
  },
  workspace_too_large: {
    status: 413,
    message: "This workspace is too large to save. Remove an image or older records.",
  },
};

function jsonResponse(body: unknown, status = 200): PreviewResponse {
  const serialized = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(serialized) as unknown;
    },
  };
}

function isQuotaError(error: unknown) {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = String(error.name);
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

function storageFailure(error: LocalStoreError, directory = false) {
  if (error.kind === "corrupt") {
    return jsonResponse(
      {
        error: directory ? "directory_unavailable" : "browser_storage_corrupt",
        message:
          "Saved browser-demo data could not be read. Clear this site's browser data to restart the demo.",
      },
      500,
    );
  }
  if (error.kind === "full") {
    return jsonResponse(
      {
        error: "browser_storage_full",
        message:
          "This browser could not save the change because its site storage is full. Remove a large profile photo or clear space, then try again.",
      },
      507,
    );
  }
  return jsonResponse(
    {
      error: directory ? "directory_unavailable" : "browser_storage_unavailable",
      message:
        "This browser is blocking local site storage, so the demo cannot load or save vendor data.",
    },
    503,
  );
}

function validationFailure(error: z.ZodError) {
  return jsonResponse(
    {
      error: "invalid_request",
      message: "Some fields were not accepted. Review the form and try again.",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    400,
  );
}

function domainFailure(error: VendorStateError) {
  const mapped = DOMAIN_ERRORS[error.code] ?? {
    status: 400,
    message: "The requested change was not accepted.",
  };
  return jsonResponse(
    { error: error.code, message: mapped.message },
    mapped.status,
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

function pathFrom(url: string | URL) {
  try {
    return new URL(String(url), "https://github-preview.invalid").pathname;
  } catch {
    return "";
  }
}

export function createPreviewApi(options: PreviewOptions = {}): PreviewApi {
  const getStorage = options.getStorage ?? (() => window.localStorage);
  const now = options.now ?? (() => new Date());

  function storage() {
    try {
      const value = getStorage();
      if (
        !value ||
        typeof value.getItem !== "function" ||
        typeof value.setItem !== "function"
      ) {
        throw new TypeError("Local storage is unavailable");
      }
      return value;
    } catch {
      throw new LocalStoreError("unavailable");
    }
  }

  function read(): StoredWorkspace | null {
    let raw: string | null;
    try {
      raw = storage().getItem(STORAGE_KEY);
    } catch (error) {
      if (error instanceof LocalStoreError) throw error;
      throw new LocalStoreError("unavailable");
    }
    if (raw === null) return null;
    try {
      return storedSchema.parse(JSON.parse(raw));
    } catch {
      throw new LocalStoreError("corrupt");
    }
  }

  function write(value: StoredWorkspace) {
    const serialized = JSON.stringify(storedSchema.parse(value));
    let localStorage: StorageLike;
    try {
      localStorage = storage();
    } catch (error) {
      if (error instanceof LocalStoreError) throw error;
      throw new LocalStoreError("unavailable");
    }
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      throw new LocalStoreError(isQuotaError(error) ? "full" : "unavailable");
    }
  }

  function current() {
    return read() ?? { version: 0, state: emptyWorkspace() };
  }

  function getWorkspace() {
    try {
      const stored = current();
      return jsonResponse({
        state: stored.state,
        version: stored.version,
        user: { displayName: "Vendor" },
      });
    } catch (error) {
      return storageFailure(
        error instanceof LocalStoreError
          ? error
          : new LocalStoreError("unavailable"),
      );
    }
  }

  function patchWorkspace(rawBody: unknown) {
    let input: ReturnType<typeof parsePatchRequest>;
    try {
      if (typeof rawBody !== "string") throw new SyntaxError();
      if (new TextEncoder().encode(rawBody).length > MAX_PATCH_BODY_BYTES) {
        return jsonResponse(
          {
            error: "request_too_large",
            message: "This save is too large. Use a smaller profile photo and try again.",
          },
          413,
        );
      }
      input = parsePatchRequest(JSON.parse(rawBody) as unknown);
    } catch (error) {
      if (error instanceof z.ZodError) return validationFailure(error);
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    let stored: StoredWorkspace;
    try {
      stored = current();
    } catch (error) {
      return storageFailure(
        error instanceof LocalStoreError
          ? error
          : new LocalStoreError("unavailable"),
      );
    }

    if (stored.version !== input.version) {
      return jsonResponse(
        {
          error: "version_conflict",
          state: stored.state,
          version: stored.version,
        },
        409,
      );
    }

    let nextState;
    try {
      nextState = applyWorkspaceAction(
        stored.state,
        { action: input.action, payload: input.payload },
        now(),
      );
    } catch (error) {
      if (error instanceof z.ZodError) return validationFailure(error);
      if (error instanceof VendorStateError) return domainFailure(error);
      return jsonResponse({ error: "workspace_update_failed" }, 500);
    }

    const next = { version: stored.version + 1, state: nextState };
    try {
      write(next);
    } catch (error) {
      return storageFailure(
        error instanceof LocalStoreError
          ? error
          : new LocalStoreError("unavailable"),
      );
    }
    return jsonResponse({ state: next.state, version: next.version });
  }

  function getDirectory() {
    try {
      const stored = read();
      if (!stored || !stored.state.profile.published) {
        return jsonResponse({ profiles: [] });
      }
      const today = dateInMarketTimezone(now());
      const offers = stored.state.offers
        .filter((offer) => isOfferActive(offer, today))
        .sort(
          (left, right) =>
            left.endDate.localeCompare(right.endDate) ||
            left.title.localeCompare(right.title),
        );
      return jsonResponse({
        profiles: [
          {
            id: LOCAL_PROFILE_ID,
            profile: { ...stored.state.profile, published: true },
            offers,
          },
        ],
      });
    } catch (error) {
      return storageFailure(
        error instanceof LocalStoreError
          ? error
          : new LocalStoreError("unavailable"),
        true,
      );
    }
  }

  return {
    async request(url, requestOptions = {}) {
      const path = pathFrom(url);
      const method = (requestOptions.method ?? "GET").toUpperCase();
      if (path === "/api/workspace") {
        if (method === "GET") return getWorkspace();
        if (method === "PATCH") return patchWorkspace(requestOptions.body);
        return jsonResponse({ error: "method_not_allowed" }, 405);
      }
      if (path === "/api/directory") {
        if (method === "GET") return getDirectory();
        return jsonResponse({ error: "method_not_allowed" }, 405);
      }
      return jsonResponse({ error: "not_found" }, 404);
    },
  };
}

declare global {
  interface Window {
    FSMPreview: PreviewApi;
  }
}

if (typeof window !== "undefined") {
  window.FSMPreview = createPreviewApi();
}
