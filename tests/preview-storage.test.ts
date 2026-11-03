import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_PROFILE_ID,
  STORAGE_KEY,
  createPreviewApi,
  type PreviewApi,
} from "../src/preview-storage.ts";

const NOW = new Date("2026-11-03T18:00:00.000Z");

class MemoryStorage {
  data = new Map<string, string>();
  writes = 0;

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
}

function apiFor(storage: Pick<Storage, "getItem" | "setItem">) {
  return createPreviewApi({ getStorage: () => storage, now: () => NOW });
}

async function body(response: Awaited<ReturnType<PreviewApi["request"]>>) {
  return (await response.json()) as any;
}

async function patch(
  api: PreviewApi,
  version: number,
  action: string,
  payload: unknown,
) {
  const response = await api.request("/api/workspace", {
    method: "PATCH",
    body: JSON.stringify({ version, action, payload }),
  });
  return { response, data: await body(response) };
}

const completeProfile = {
  businessName: "Oak & Honey",
  city: "Carrollton",
  shortDescription: "Small-batch pantry goods",
  about: "Seasonal preserves made in North Texas.",
  categories: ["Pantry"],
  website: "https://example.com",
  instagram: "https://instagram.com/example",
  photoData: "",
  published: true,
};

test("an empty workspace contains no personal data and GET does not write", async () => {
  const storage = new MemoryStorage();
  const api = apiFor(storage);
  const response = await api.request("/api/workspace");
  const data = await body(response);

  assert.equal(response.status, 200);
  assert.equal(data.version, 0);
  assert.equal(data.user.displayName, "Vendor");
  assert.deepEqual(data.state.profile, {
    businessName: "",
    city: "",
    shortDescription: "",
    about: "",
    categories: [],
    website: "",
    instagram: "",
    photoData: "",
    published: false,
  });
  assert.deepEqual(data.state.reservations, []);
  assert.deepEqual(data.state.offers, []);
  assert.deepEqual(data.state.promotions, []);
  assert.equal(storage.writes, 0);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("all four vendor workflows persist across adapter instances", async () => {
  const storage = new MemoryStorage();
  const first = apiFor(storage);

  let result = await patch(first, 0, "reservation.request", {
    marketId: "richardson",
    date: "2026-11-07",
    boothSize: "10x10",
    notes: "Near power if possible",
  });
  assert.equal(result.response.ok, true);
  assert.equal(result.data.state.reservations[0].estimatedFee, 45);
  const reservationId = result.data.state.reservations[0].id;

  result = await patch(first, 1, "offer.save", {
    title: "Weekend bundle",
    description: "Two jars for one market price",
    type: "bundle",
    value: "$18",
    marketIds: ["richardson"],
    startDate: "2026-11-03",
    endDate: "2026-11-07",
    status: "published",
  });
  assert.equal(result.response.ok, true);
  const offerId = result.data.state.offers[0].id;

  result = await patch(first, 2, "profile.save", completeProfile);
  assert.equal(result.response.ok, true);
  assert.equal(result.data.state.profile.published, true);

  result = await patch(first, 3, "promotion.save", {
    title: "Saturday card",
    headline: "See you Saturday",
    caption: "Find us by the main entrance.",
    marketId: "richardson",
    reservationId,
    offerId,
    format: "square",
  });
  assert.equal(result.response.ok, true);
  assert.equal(result.data.version, 4);
  assert.equal(result.data.state.promotions[0].offerId, offerId);

  const second = apiFor(storage);
  const reloaded = await body(await second.request("/api/workspace"));
  assert.equal(reloaded.version, 4);
  assert.equal(reloaded.state.reservations[0].id, reservationId);
  assert.equal(reloaded.state.offers[0].id, offerId);
  assert.equal(reloaded.state.profile.businessName, "Oak & Honey");
  assert.equal(reloaded.state.promotions[0].headline, "See you Saturday");

  const promotionId = reloaded.state.promotions[0].id;
  assert.equal(
    (await patch(second, 4, "promotion.delete", { id: promotionId })).response.ok,
    true,
  );
  assert.equal(
    (await patch(second, 5, "offer.archive", { id: offerId })).response.ok,
    true,
  );
  assert.equal(
    (await patch(second, 6, "reservation.cancel", { id: reservationId })).response.ok,
    true,
  );
  assert.equal(
    (
      await patch(second, 7, "profile.save", {
        ...completeProfile,
        published: false,
      })
    ).response.ok,
    true,
  );

  const finalState = await body(await first.request("/api/workspace"));
  assert.equal(finalState.version, 8);
  assert.equal(finalState.state.reservations[0].status, "cancelled");
  assert.equal(finalState.state.offers[0].status, "archived");
  assert.equal(finalState.state.profile.published, false);
  assert.deepEqual(finalState.state.promotions, []);
});

test("a stale write returns the latest state without mutating it", async () => {
  const storage = new MemoryStorage();
  const first = apiFor(storage);
  const second = apiFor(storage);

  const saved = await patch(first, 0, "profile.save", {
    ...completeProfile,
    published: false,
  });
  assert.equal(saved.response.status, 200);

  const stale = await patch(second, 0, "profile.save", completeProfile);
  assert.equal(stale.response.status, 409);
  assert.equal(stale.data.error, "version_conflict");
  assert.equal(stale.data.version, 1);
  assert.equal(stale.data.state.profile.published, false);
  assert.equal(storage.writes, 1);
});

test("invalid JSON and invalid action payloads do not create stored state", async () => {
  const storage = new MemoryStorage();
  const api = apiFor(storage);

  const malformed = await api.request("/api/workspace", {
    method: "PATCH",
    body: "{not json",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await body(malformed)).error, "invalid_json");

  const invalid = await patch(api, 0, "profile.save", {
    ...completeProfile,
    businessName: "",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.error, "invalid_request");
  assert.ok(invalid.data.issues.length > 0);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("denied reads and denied or quota-exhausted writes never report success", async () => {
  const securityError = Object.assign(new Error("denied"), {
    name: "SecurityError",
  });
  const deniedRead = createPreviewApi({
    getStorage: () => {
      throw securityError;
    },
    now: () => NOW,
  });
  const deniedGet = await deniedRead.request("/api/workspace");
  assert.equal(deniedGet.status, 503);
  assert.equal((await body(deniedGet)).error, "browser_storage_unavailable");

  const deniedWriteStorage = {
    getItem: () => null,
    setItem: () => {
      throw securityError;
    },
  };
  const deniedWrite = await patch(
    apiFor(deniedWriteStorage),
    0,
    "profile.save",
    { ...completeProfile, published: false },
  );
  assert.equal(deniedWrite.response.status, 503);
  assert.equal(deniedWrite.data.error, "browser_storage_unavailable");

  const quotaError = Object.assign(new Error("full"), {
    name: "QuotaExceededError",
  });
  const quotaStorage = {
    getItem: () => null,
    setItem: () => {
      throw quotaError;
    },
  };
  const quota = await patch(apiFor(quotaStorage), 0, "profile.save", {
    ...completeProfile,
    published: false,
  });
  assert.equal(quota.response.status, 507);
  assert.equal(quota.data.error, "browser_storage_full");
  const stillEmpty = await body(await apiFor(quotaStorage).request("/api/workspace"));
  assert.equal(stillEmpty.version, 0);
  assert.equal(stillEmpty.state.profile.businessName, "");
});

test("malformed stored data is preserved and returned as a clear failure", async () => {
  const storage = new MemoryStorage();
  storage.data.set(STORAGE_KEY, "{broken");
  const api = apiFor(storage);

  const get = await api.request("/api/workspace");
  assert.equal(get.status, 500);
  assert.equal((await body(get)).error, "browser_storage_corrupt");

  const attemptedWrite = await patch(api, 0, "profile.save", completeProfile);
  assert.equal(attemptedWrite.response.status, 500);
  assert.equal(storage.getItem(STORAGE_KEY), "{broken");
  assert.equal(storage.writes, 0);
});

test("directory visibility is local, publication-gated, date-filtered, and sorted", async () => {
  const storage = new MemoryStorage();
  const api = apiFor(storage);
  let version = 0;

  for (const offer of [
    {
      title: "Later ending",
      description: "Active through the weekend",
      type: "other",
      value: "",
      marketIds: ["richardson"],
      startDate: "2026-11-01",
      endDate: "2026-11-05",
      status: "published",
    },
    {
      title: "Sooner ending",
      description: "Active today",
      type: "other",
      value: "",
      marketIds: ["richardson"],
      startDate: "2026-11-03",
      endDate: "2026-11-04",
      status: "published",
    },
    {
      title: "Expired",
      description: "No longer active",
      type: "other",
      value: "",
      marketIds: ["richardson"],
      startDate: "2026-10-01",
      endDate: "2026-11-02",
      status: "published",
    },
    {
      title: "Future",
      description: "Not active yet",
      type: "other",
      value: "",
      marketIds: ["richardson"],
      startDate: "2026-11-04",
      endDate: "2026-11-08",
      status: "published",
    },
    {
      title: "Draft",
      description: "Not published",
      type: "other",
      value: "",
      marketIds: [],
      startDate: "",
      endDate: "",
      status: "draft",
    },
  ]) {
    const saved = await patch(api, version, "offer.save", offer);
    assert.equal(saved.response.ok, true);
    version = saved.data.version;
  }

  let directory = await body(await api.request("/api/directory"));
  assert.deepEqual(directory.profiles, []);

  const published = await patch(api, version, "profile.save", completeProfile);
  assert.equal(published.response.ok, true);
  version = published.data.version;

  directory = await body(await api.request("/api/directory"));
  assert.equal(directory.profiles.length, 1);
  assert.equal(directory.profiles[0].id, LOCAL_PROFILE_ID);
  assert.deepEqual(
    directory.profiles[0].offers.map((offer: any) => offer.title),
    ["Sooner ending", "Later ending"],
  );

  await patch(api, version, "profile.save", {
    ...completeProfile,
    published: false,
  });
  directory = await body(await api.request("/api/directory"));
  assert.deepEqual(directory.profiles, []);
});

test("unknown routes and unsupported methods are explicit", async () => {
  const api = apiFor(new MemoryStorage());
  assert.equal((await api.request("/not-an-api")).status, 404);
  assert.equal(
    (await api.request("/api/directory", { method: "POST" })).status,
    405,
  );
});
