import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BULK_STATUS_VEHICLES,
  getBulkStatusDecision,
  normalizeBulkStatusRequest
} from "../src/services/bulk-status-service.js";

test("normalizes and deduplicates vehicle ids", () => {
  assert.deepEqual(
    normalizeBulkStatusRequest({ vehicle_ids: [" a ", "b", "a", ""], status: "to_detail" }),
    { vehicleIds: ["a", "b"], status: "to_detail" }
  );
});

test("rejects an unknown target status", () => {
  assert.throws(
    () => normalizeBulkStatusRequest({ vehicle_ids: ["a"], status: "teleported" }),
    /valid target status/i
  );
});

test("rejects an oversized batch", () => {
  const vehicleIds = Array.from({ length: MAX_BULK_STATUS_VEHICLES + 1 }, (_, index) => `vehicle-${index}`);
  assert.throws(
    () => normalizeBulkStatusRequest({ vehicle_ids: vehicleIds, status: "to_detail" }),
    new RegExp(`limited to ${MAX_BULK_STATUS_VEHICLES}`, "i")
  );
});

test("skips archived and unchanged vehicles", () => {
  assert.equal(getBulkStatusDecision({ is_archived: true, status: "submitted" }, "to_detail").allowed, false);
  assert.equal(getBulkStatusDecision({ is_archived: false, status: "to_detail" }, "to_detail").allowed, false);
});

test("preserves workflow guards", () => {
  const decision = getBulkStatusDecision({ is_archived: false, status: "submitted" }, "detail_finished");
  assert.equal(decision.allowed, false);
  assert.match(decision.message, /must be started/i);
});
