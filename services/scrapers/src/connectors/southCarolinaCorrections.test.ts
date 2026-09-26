import assert from "node:assert/strict";
import test from "node:test";
import { parseSouthCarolinaResults } from "./southCarolinaCorrections.js";

const response = [{
  scdcId: "00123456",
  fname: "JOHN     ",
  mname: "MICHAEL  ",
  lname: "SMITH              ",
  dateOfBirth: "1982-05-14",
  age: "43",
  institution: "BROAD RIVER",
  race: "WHITE",
  sex: "MALE",
  offense: "PUBLIC RECORD OFFENSE",
  projMaxoutDate: "2030-01-01",
}];

test("normalizes an exact South Carolina DOC result", () => {
  const people = parseSouthCarolinaResults(response, { firstName: "John", lastName: "Smith", state: "SC" });
  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "00123456");
  assert.equal(people[0].middleName, "MICHAEL");
  assert.equal(people[0].dobYear, 1982);
  assert.equal(people[0].records?.[0].state, "SC");
  assert.match(people[0].records?.[0].disposition ?? "", /Institution: BROAD RIVER/);
});

test("rejects a non-exact South Carolina name", () => {
  assert.deepEqual(
    parseSouthCarolinaResults(response, { firstName: "Johnny", lastName: "Smith", state: "SC" }),
    [],
  );
});

test("handles an empty South Carolina response", () => {
  assert.deepEqual(
    parseSouthCarolinaResults([], { firstName: "John", lastName: "Smith", state: "SC" }),
    [],
  );
});