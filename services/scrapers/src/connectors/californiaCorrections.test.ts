import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCirisResults } from "./californiaCorrections.js";

const result = {
  cdcrNumber: "CB7566",
  lastName: "SMITH",
  firstName: "JOHN",
  middleName: "BARAJAS",
  admissionDate: "2025-08-18T07:00:00Z",
  location: "Kern Valley State Prison",
  commitmentCounties: ["San Diego"],
};

test("normalizes an exact California CDCR result", () => {
  const people = normalizeCirisResults([result], { firstName: "John", lastName: "Smith", state: "CA" });
  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "CB7566");
  assert.equal(people[0].records?.[0].state, "CA");
  assert.equal(people[0].records?.[0].filingDate, "2025-08-18");
  assert.match(people[0].records?.[0].disposition ?? "", /Kern Valley State Prison/);
});

test("rejects a non-exact California name", () => {
  assert.deepEqual(normalizeCirisResults([result], { firstName: "Johnny", lastName: "Smith", state: "CA" }), []);
});