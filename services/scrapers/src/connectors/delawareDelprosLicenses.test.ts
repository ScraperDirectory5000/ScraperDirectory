import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDelprosResults } from "./delawareDelprosLicenses.js";

const results = [{
  ApplicationType: "Examination",
  Board: "Plumbing/HVACR",
  City: "SALISBURY",
  Name: "JOHN E SMITH",
  RecNumber: "PL-0000104",
  State: "MD",
  Status: "Expired",
  Type: "Master Plumber",
  license: { v: { Id: "a0e8y0000012345AAA" } },
}];

test("normalizes an exact DELPROS license with its official detail URL", () => {
  const people = normalizeDelprosResults(results, { firstName: "John", lastName: "Smith", state: "DE" });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "PL-0000104");
  assert.equal(people[0].middleName, "E");
  assert.equal(people[0].records?.[0].state, "DE");
  assert.equal(people[0].records?.[0].caseType, "professional_license");
  assert.match(people[0].records?.[0].disposition ?? "", /Status: Expired/);
  assert.equal(
    people[0].records?.[0].sourceUrl,
    "https://delpros.delaware.gov/oh_verifylicensedetails?pid=a0e8y0000012345AAA",
  );
});

test("rejects partial names and rows without official license numbers", () => {
  assert.deepEqual(
    normalizeDelprosResults(results, { firstName: "Johnny", lastName: "Smith", state: "DE" }),
    [],
  );
  assert.deepEqual(
    normalizeDelprosResults([{ ...results[0], RecNumber: "" }], {
      firstName: "John",
      lastName: "Smith",
      state: "DE",
    }),
    [],
  );
});

test("recognizes comma-form names and ignores suffixes for exact matching", () => {
  const people = normalizeDelprosResults([{
    ...results[0],
    Name: "SMITH, JOHN ALLEN JR",
  }], { firstName: "john", lastName: "smith", state: "DE" });

  assert.equal(people[0].middleName, "ALLEN");
});

test("classifies non-issued DELPROS application numbers separately", () => {
  const people = normalizeDelprosResults([{
    ...results[0],
    RecNumber: "APP-000043869",
    Status: "Cancelled",
  }], { firstName: "John", lastName: "Smith", state: "DE" });

  assert.equal(people[0].records?.[0].caseType, "professional_license_application");
});

test("surfaces a provider result-limit response", () => {
  assert.throws(
    () => normalizeDelprosResults([{ returnedDataHasHitLimit: true }], {
      firstName: "John",
      lastName: "Smith",
      state: "DE",
    }),
    /too broad/,
  );
});