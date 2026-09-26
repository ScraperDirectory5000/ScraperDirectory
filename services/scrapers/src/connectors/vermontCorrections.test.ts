import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeVermontRoster,
  VERMONT_DOC_DATASET_URL,
  VermontCorrectionsConnector,
} from "./vermontCorrections.js";

const rows = [{
  offenderid: "171596",
  offenderlastname: "DUMONT",
  offenderfirstname: "CHELSEA",
  offendermiddlename: "ANN",
  bookingdate: "2026-09-26T00:42:00.000",
  legalstatusagency: "Chittenden Regional Correctional Facility (CRCF)",
  legalstatusstartdate: "2026-09-26T00:00:00.000",
  legalstatus: "Detained",
  chargestatus: "Pending",
}, {
  offenderid: "171596",
  offenderlastname: "DUMONT",
  offenderfirstname: "CHELSEA",
  legalstatusagency: "Chittenden Regional Correctional Facility (CRCF)",
  legalstatus: "Detained",
  chargestatus: "Detained",
}, {
  offenderid: "999999",
  offenderlastname: "DUMONT",
  offenderfirstname: "CHEL",
  legalstatusagency: "Northwest State Correctional Facility (NWSCF)",
  legalstatus: "Sentenced",
}];

test("normalizes and deduplicates exact Vermont DOC roster rows", () => {
  const people = normalizeVermontRoster(rows, { firstName: "Chelsea", lastName: "Dumont", state: "VT" });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "171596");
  assert.equal(people[0].middleName, "ANN");
  assert.equal(people[0].records?.[0].caseNumber, "171596");
  assert.equal(people[0].records?.[0].state, "VT");
  assert.equal(people[0].records?.[0].caseType, "corrections_record");
  assert.equal(people[0].records?.[0].filingDate, "2026-09-26");
  assert.equal(
    people[0].records?.[0].disposition,
    "Status: Detained | Location: Chittenden Regional Correctional Facility (CRCF) | Charge status: Pending"
  );
  assert.equal(
    people[0].records?.[0].sourceUrl,
    "https://data.vermont.gov/resource/vf3r-u4kv.json?offenderid=171596"
  );
  assert.equal(
    VERMONT_DOC_DATASET_URL,
    "https://data.vermont.gov/Public-Safety/DOCPublicUseFile/vf3r-u4kv/about_data"
  );
});

test("rejects non-exact and incomplete Vermont roster rows", () => {
  assert.deepEqual(normalizeVermontRoster(rows, { firstName: "Che", lastName: "Dumont", state: "VT" }), []);
  assert.deepEqual(normalizeVermontRoster([{ ...rows[0], legalstatusagency: "" }], {
    firstName: "Chelsea",
    lastName: "Dumont",
    state: "VT",
  }), []);
});

test("live Vermont DOC roster returns current status and location for an exact name", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new VermontCorrectionsConnector().search({
    firstName: "Chelsea",
    lastName: "Dumont",
    state: "VT",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "chelsea"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "dumont"));
  assert.ok(people.every((person) => /^\d+$/.test(person.externalId ?? "")));
  assert.ok(people.every((person) => /Status: .+ \| Location: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.startsWith("https://data.vermont.gov/")));
});