import assert from "node:assert/strict";
import test from "node:test";
import { parseMarylandResults } from "./marylandCorrections.js";

const resultHtml = `<table id="gvSearchInmate"><tr><th>Full Name</th></tr><tr>
  <td><font>John Michael Smith</font></td><td><font>00508604</font></td>
  <td><font>3011141</font></td><td><font>Male</font></td><td><font>09/1967</font></td>
  <td><font>MCTC</font></td><td><font>Maryland Correctional Training Center</font></td>
</tr></table>`;

test("normalizes an exact Maryland DPSCS result", () => {
  const people = parseMarylandResults(resultHtml, { firstName: "John", lastName: "Smith", state: "MD" });
  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "00508604");
  assert.equal(people[0].middleName, "Michael");
  assert.equal(people[0].dobYear, 1967);
  assert.equal(people[0].records?.[0].state, "MD");
  assert.match(people[0].records?.[0].disposition ?? "", /SID: 3011141/);
});

test("rejects a non-exact Maryland name", () => {
  assert.deepEqual(parseMarylandResults(resultHtml, { firstName: "Johnny", lastName: "Smith", state: "MD" }), []);
});