import assert from "node:assert/strict";
import test from "node:test";
import { exactIowaResults, parseIowaDetail } from "./iowaCorrections.js";

const results = [
  { Name: "JOHN ALBERT SMITH", OffenderNumber: "0064662   ", Gender: "M", Age: 56 },
  { Name: "John Allen Smith", OffenderNumber: "0037566   ", Gender: "M", Age: 58 },
  { Name: "Johnnie Michael Smith", OffenderNumber: "1138202   ", Gender: "M", Age: 56 },
  { Name: "John Patrick Smithburg", OffenderNumber: "1098408   ", Gender: "M", Age: 52 },
];

const detailHtml = `<table><tr><td>Unrelated page cell</td><td>Not a supervision status</td></tr></table>
<div><div class="label">Location: </div><div>Des Moines Area</div></div>
<table id="charges"><thead><tr><th></th><th>Supervision Status</th><th>Offense Class</th><th>County</th><th>End Date</th></tr></thead>
<tbody><tr><td></td><td>Pretrial Release With Supervision</td><td>Aggravated Misdemeanor</td><td>Iowa</td><td>11/29/1988</td></tr>
<tr><td></td><td>Probation</td><td>Serious Misdemeanor</td><td>Iowa</td><td>01/28/1991</td></tr></tbody></table>`;

test("keeps only exact Iowa first and last names", () => {
  const matches = exactIowaResults(results, { firstName: "John", lastName: "Smith", state: "IA" });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].OffenderNumber?.trim(), "0064662");
});

test("normalizes Iowa detail with stable official ID and disposition", () => {
  const person = parseIowaDetail(detailHtml, results[0]);
  assert.equal(person.externalId, "0064662");
  assert.equal(person.middleName, "ALBERT");
  assert.equal(person.records?.[0].state, "IA");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.match(person.records?.[0].disposition ?? "", /Location: Des Moines Area/);
  assert.match(person.records?.[0].disposition ?? "", /Pretrial Release With Supervision, Probation/);
  assert.equal(
    person.records?.[0].sourceUrl,
    "https://doc-search.iowa.gov/offender/detail?offenderNumber=0064662"
  );
});