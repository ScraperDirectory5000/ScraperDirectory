import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNewYorkDosLicenses } from "./newYorkDosLicenses.js";

test("normalizes exact DOS appraiser and appearance-license names", () => {
  const people = normalizeNewYorkDosLicenses(
    [{
      applicant_name: "SMITH JOHN A",
      uid: "45000012345",
      license_type: "CERTIFIED RESIDENTIAL REAL ESTATE APPRAISER",
      org_date: "2006-09-18T00:00:00.000",
      exp_date: "2028-09-17T00:00:00.000",
      prin_bus_name: "SMITH APPRAISALS",
      business_city: "ALBANY",
      st: "NY",
    }],
    [{
      license_holder_name: "Smith John B Jr",
      license_number: "22AB1234567",
      license_type: "Barber - Operator",
      license_effective_term: "2025-05-01T00:00:00.000",
      license_expiration_date: "2029-05-01T00:00:00.000",
    }],
    { firstName: "John", lastName: "Smith", state: "NY" },
  );

  assert.equal(people.length, 2);
  assert.deepEqual(people.map((person) => person.externalId), ["45000012345", "22AB1234567"]);
  assert.deepEqual(people.map((person) => person.middleName), ["A", "B JR"]);
  assert.deepEqual(people.map((person) => person.records?.[0].state), ["NY", "NY"]);
  assert.equal(people[0].records?.[0].filingDate, "2006-09-18");
  assert.match(people[0].records?.[0].disposition ?? "", /Business location: ALBANY, NY/);
  assert.equal(people[0].addresses, undefined);
});

test("rejects partial names and rows without stable official IDs", () => {
  const people = normalizeNewYorkDosLicenses(
    [
      { applicant_name: "SMITH JOHNNY", uid: "45000000001" },
      { applicant_name: "SMITHSON JOHN", uid: "45000000002" },
      { applicant_name: "SMITH JOHN" },
    ],
    [
      { license_holder_name: "SMITH JOHANNA", license_number: "22AB0000001" },
      { license_holder_name: "SMITH JOHN" },
    ],
    { firstName: "John", lastName: "Smith", state: "NY" },
  );

  assert.deepEqual(people, []);
});