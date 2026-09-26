import assert from "node:assert/strict";
import test from "node:test";
import { parsePennsylvaniaResults } from "./pennsylvaniaCorrections.js";

const response = {
  inmates: [{
    inmate_number: "AB1234",
    inm_firstname: " JOHN ",
    inm_middlename: " MICHAEL ",
    inm_lastname: " SMITH ",
    inm_namesuffix: " JR ",
    dob: "05/14/1982",
    cnty_name: "DAUPHIN",
    fac_name: "SCI CAMP HILL",
  }],
};

test("normalizes an exact Pennsylvania DOC result", () => {
  const people = parsePennsylvaniaResults(response, { firstName: "John", lastName: "Smith", state: "PA" });
  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "AB1234");
  assert.equal(people[0].middleName, "MICHAEL");
  assert.equal(people[0].dobYear, 1982);
  assert.equal(people[0].records?.[0].state, "PA");
  assert.match(people[0].records?.[0].disposition ?? "", /Facility: SCI CAMP HILL/);
});

test("rejects a non-exact Pennsylvania name", () => {
  assert.deepEqual(
    parsePennsylvaniaResults(response, { firstName: "Johnny", lastName: "Smith", state: "PA" }),
    [],
  );
});

test("handles a Pennsylvania response without inmates", () => {
  assert.deepEqual(
    parsePennsylvaniaResults({}, { firstName: "John", lastName: "Smith", state: "PA" }),
    [],
  );
});