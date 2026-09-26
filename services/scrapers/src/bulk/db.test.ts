import assert from "node:assert/strict";
import test from "node:test";
import { buildStagePayload } from "./db.js";

test("builds snake-case rows for PostgreSQL jsonb_to_recordset", () => {
  const [row] = buildStagePayload([{
    source: "connecticut_state_licenses",
    sourceRecordId: "42",
    firstName: "ANA",
    middleName: "M",
    lastName: "DIAZ",
    address: { street: "1 MAIN ST", city: "HARTFORD", state: "CT", zip: "06103-1234" },
    credential: {
      type: "RN",
      name: "REGISTERED NURSE",
      number: "123",
      status: "ACTIVE",
      issueDate: "2020-01-01",
    },
  }], "https://data.ct.gov/resource/ngch-56tr.json");

  assert.deepEqual(Object.keys(row).sort(), [
    "address", "city", "dob_year", "end_date", "external_id", "first_name", "last_name",
    "middle_name", "person_id", "record_description", "record_number", "record_status",
    "record_title", "record_type", "source_record_id", "source_url", "start_date", "state", "zip_code",
  ]);
  assert.equal((row as { source_record_id: string }).source_record_id, "42");
  assert.equal((row as { zip_code: string }).zip_code, "06103-1234");
});