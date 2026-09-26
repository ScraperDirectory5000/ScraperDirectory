import assert from "node:assert/strict";
import test from "node:test";
import { parseIllinoisCandidates, parseIllinoisDetail } from "./illinoisCorrections.js";

const resultsHtml = `<select name="idoc" size="10">
  <option>M50653 | 04-07-1994 | SMITH, JOHN</option>
  <option>B26114 | 07-30-1970 | SMITH, JOHN D.</option>
  <option>Y72665 | 08-14-2007 | SMITH, JOHNELL III</option>
</select>`;

const detailHtml = `<table>
  <tr><td>Parent Institution:</td><td>LAWRENCE CORRECTIONAL CENTER</td></tr>
  <tr><td>Offender Status:</td><td>PAROLE</td></tr>
  <tr><td>Location:</td><td>PAROLE DISTRICT 1</td></tr>
</table>`;

test("normalizes exact Illinois IDOC candidates and detail", () => {
  const candidates = parseIllinoisCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "IL",
  });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].idocNumber, "M50653");
  assert.equal(candidates[0].dobYear, 1994);
  assert.equal(candidates[1].middleName, "D");

  const person = parseIllinoisDetail(detailHtml, candidates[0]);
  assert.equal(person.externalId, "M50653");
  assert.equal(person.records?.[0].state, "IL");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.match(person.records?.[0].disposition ?? "", /Status: PAROLE/);
  assert.match(person.records?.[0].disposition ?? "", /LAWRENCE CORRECTIONAL CENTER/);
  assert.equal(person.records?.[0].sourceUrl, "https://idoc.illinois.gov/offender/inmatesearch.html");
});

test("rejects partial Illinois first and last names", () => {
  assert.deepEqual(
    parseIllinoisCandidates(resultsHtml, { firstName: "Johnell", lastName: "Smith", state: "IL" }),
    [{
      idocNumber: "Y72665",
      firstName: "JOHNELL",
      middleName: "III",
      lastName: "SMITH",
      dobYear: 2007,
    }]
  );
  assert.deepEqual(
    parseIllinoisCandidates(resultsHtml, { firstName: "John", lastName: "Smit", state: "IL" }),
    []
  );
});