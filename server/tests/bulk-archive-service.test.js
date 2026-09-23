import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BULK_ARCHIVE_VEHICLES,
  getBulkArchiveDecision,
  normalizeBulkArchiveRequest
} from "../src/services/bulk-archive-service.js";

test("normalizes and deduplicates bulk archive vehicle ids", () => {
  assert.deepEqual(
    normalizeBulkArchiveRequest({ vehicle_ids: [" a ", "b", "a", ""] }),
    { vehicleIds: ["a", "b"] }
  );
});

test("rejects an empty bulk archive request", () => {
  assert.throws(
    () => normalizeBulkArchiveRequest({ vehicle_ids: [] }),
    /at least one vehicle/i
  );
});

test("rejects a malformed bulk archive request", () => {
  assert.throws(
    () => normalizeBulkArchiveRequest({ vehicle_ids: "vehicle-a" }),
    /at least one vehicle/i
  );
});

test("rejects an oversized bulk archive request", () => {
  const vehicleIds = Array.from({ length: MAX_BULK_ARCHIVE_VEHICLES + 1 }, (_, index) => `vehicle-${index}`);
  assert.throws(
    () => normalizeBulkArchiveRequest({ vehicle_ids: vehicleIds }),
    new RegExp(`limited to ${MAX_BULK_ARCHIVE_VEHICLES}`, "i")
  );
});

test("skips vehicles that are already archived", () => {
  assert.equal(getBulkArchiveDecision({ is_archived: true }).allowed, false);
  assert.match(getBulkArchiveDecision({ is_archived: true }).message, /already been archived/i);
  assert.equal(getBulkArchiveDecision({ is_archived: false }).allowed, true);
});
