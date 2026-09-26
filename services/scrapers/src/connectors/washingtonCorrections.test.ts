import assert from "node:assert/strict";
import test from "node:test";
import { parseWashingtonCorrectionsResults, WashingtonCorrectionsConnector } from "./washingtonCorrections.js";

const resultsHtml = `<table>
  <tr><th>DOC Number</th><th>Name</th><th>Age</th><th>Facility</th><th>Unit</th></tr>
  <tr>
    <td class="views-field-field-doc-number">326590</td>
    <td class="views-field-field-last-name"><a href="https://vinelink.vineapps.com/offender-detail/48626/900/326590">ADAMS, DAVID R</a></td>
    <td>41</td><td>Washington State Penitentiary</td><td>B-BB2111L</td>
  </tr>
  <tr>
    <td>418101</td><td>ADAMS JR., VICTOR D</td><td>30</td><td>Stafford Creek Corrections Center</td><td>H6-H6038U</td>
  </tr>
  <tr><td>999999</td><td>ADAMSON, DAVID</td><td>50</td><td>Other</td><td>N/A</td></tr>
</table>`;

test("normalizes an exact Washington DOC result", () => {
  const people = parseWashingtonCorrectionsResults(resultsHtml, {
    firstName: "David",
    lastName: "Adams",
    state: "WA",
  });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "326590");
  assert.equal(people[0].middleName, "R");
  assert.equal(people[0].records?.[0].state, "WA");
  assert.equal(people[0].records?.[0].caseType, "corrections_record");
  assert.match(people[0].records?.[0].disposition ?? "", /Currently incarcerated/);
  assert.match(people[0].records?.[0].disposition ?? "", /Washington State Penitentiary/);
  assert.equal(
    people[0].records?.[0].sourceUrl,
    "https://doc.wa.gov/records/incarcerated-data-search/incarcerated-search?field_doc_number_value=326590"
  );
});

test("handles suffixes but rejects partial Washington DOC names", () => {
  const suffixed = parseWashingtonCorrectionsResults(resultsHtml, {
    firstName: "Victor",
    lastName: "Adams",
    state: "WA",
  });
  assert.equal(suffixed.length, 1);
  assert.equal(suffixed[0].externalId, "418101");

  assert.deepEqual(
    parseWashingtonCorrectionsResults(resultsHtml, { firstName: "Dave", lastName: "Adams", state: "WA" }),
    []
  );
  assert.deepEqual(
    parseWashingtonCorrectionsResults(resultsHtml, { firstName: "David", lastName: "Adam", state: "WA" }),
    []
  );
});

test("live Washington DOC search returns exact names with stable DOC numbers", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new WashingtonCorrectionsConnector().search({
    firstName: "David",
    lastName: "Adams",
    state: "WA",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "david"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "adams"));
  assert.ok(people.every((person) => /^\d+$/.test(person.externalId ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.startsWith("https://doc.wa.gov/")));
});