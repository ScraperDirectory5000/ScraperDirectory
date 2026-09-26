import assert from "node:assert/strict";
import test from "node:test";
import { parseIdocResults } from "./idahoCorrections.js";

const resultHtml = `
  <table id="people-search-results">
    <tr><th>IDOC Number</th><th>Last Name</th><th>First</th></tr>
    <tr>
      <td><div class="col-header">IDOC Number</div>100158</td>
      <td><div class="col-header">Last Name</div>Livingston</td>
      <td><div class="col-header">First Name</div>Richard</td>
      <td><div class="col-header">Middle Name</div>Michael</td>
      <td><div class="col-header">Birth Year</div>1992</td>
      <td><div class="col-header">Status</div>Discharged 10/20/2023*</td>
    </tr>
  </table>`;

test("normalizes an exact Idaho corrections result", () => {
  const people = parseIdocResults(resultHtml, { firstName: "Richard", lastName: "Livingston", state: "ID" });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "100158");
  assert.equal(people[0].middleName, "Michael");
  assert.equal(people[0].dobYear, 1992);
  assert.equal(people[0].records?.[0].state, "ID");
  assert.equal(people[0].records?.[0].caseType, "corrections_record");
  assert.equal(people[0].records?.[0].disposition, "Discharged 10/20/2023*");
});

test("rejects partial and different-name corrections results", () => {
  assert.deepEqual(
    parseIdocResults(resultHtml, { firstName: "Rick", lastName: "Livingston", state: "ID" }),
    []
  );
});