import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWyomingResults } from "./wyomingCorrections.js";

const response = {
  data: [{
    offenderID: 112452,
    docID: "WHM02120037321",
    firstName: "Wyatt          ",
    lastName: "Smith               ",
    age: 23,
    gender: "Male",
    groupKind: "Parole",
    fromDB: "MONITOR",
  }],
};

test("normalizes an exact Wyoming WDOC result without inferring birth year", () => {
  const people = normalizeWyomingResults(response, { firstName: "Wyatt", lastName: "Smith", state: "WY" });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "MONITOR:112452");
  assert.equal(people[0].firstName, "Wyatt");
  assert.equal(people[0].lastName, "Smith");
  assert.equal(people[0].dobYear, undefined);
  assert.equal(people[0].records?.[0].caseNumber, "WHM02120037321");
  assert.equal(people[0].records?.[0].state, "WY");
  assert.equal(people[0].records?.[0].caseType, "corrections_record");
  assert.match(people[0].records?.[0].disposition ?? "", /Status: Parole/);
  assert.match(people[0].records?.[0].disposition ?? "", /Age: 23/);
  assert.match(people[0].records?.[0].disposition ?? "", /Offender ID: 112452/);
  assert.equal(
    people[0].records?.[0].sourceUrl,
    "https://wdoc-loc.wyo.gov/Home/Detail/?id=112452&dbType=MONITOR"
  );
});

test("rejects partial names, provider error rows, and incomplete identities", () => {
  assert.deepEqual(
    normalizeWyomingResults(response, { firstName: "Wy", lastName: "Smith", state: "WY" }),
    []
  );
  assert.deepEqual(
    normalizeWyomingResults({ data: [{ ...response.data[0], offenderID: -1 }] }, {
      firstName: "Wyatt",
      lastName: "Smith",
      state: "WY",
    }),
    []
  );
  assert.deepEqual(
    normalizeWyomingResults({ data: [{ ...response.data[0], docID: "" }] }, {
      firstName: "Wyatt",
      lastName: "Smith",
      state: "WY",
    }),
    []
  );
});

test("ignores unsafe age values instead of deriving a date of birth", () => {
  const people = normalizeWyomingResults({ data: [{ ...response.data[0], age: 999 }] }, {
    firstName: "Wyatt",
    lastName: "Smith",
    state: "WY",
  });

  assert.equal(people.length, 1);
  assert.doesNotMatch(people[0].records?.[0].disposition ?? "", /Age:/);
  assert.equal(people[0].dobYear, undefined);
});