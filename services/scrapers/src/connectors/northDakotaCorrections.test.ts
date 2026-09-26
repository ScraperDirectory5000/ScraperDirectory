import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNorthDakotaDetail,
  NorthDakotaCorrectionsConnector,
  parseNorthDakotaCandidates,
} from "./northDakotaCorrections.js";

const resultsHtml = `<table>
  <tr><th>ID</th><th>Last Name</th><th>First Name</th><th>Middle Name</th><th>Date of Birth</th></tr>
  <tr><td><a href="offenderDetails.asp?offenderID=66681">66681</a></td><td>SMITH</td><td>CHEYENNE</td><td>ALLEN</td><td>09/05/1993</td></tr>
  <tr><td><a href="offenderDetails.asp?offenderID=99999">99999</a></td><td>SMITH</td><td>CHEY</td><td></td><td>01/01/1990</td></tr>
</table>`;

test("parses only exact North Dakota DOCR names with stable resident IDs", () => {
  const candidates = parseNorthDakotaCandidates(resultsHtml, {
    firstName: "Cheyenne",
    lastName: "Smith",
    state: "ND",
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].residentId, "66681");
  assert.equal(candidates[0].middleName, "ALLEN");
  assert.equal(candidates[0].dobYear, 1993);
  assert.equal(candidates[0].detailUrl, "https://www.nd.gov/docr/offenderlkup/offenderDetails.asp?offenderID=66681");
});

test("normalizes current status and facility from a matching North Dakota detail", () => {
  const candidate = parseNorthDakotaCandidates(resultsHtml, {
    firstName: "Cheyenne",
    lastName: "Smith",
    state: "ND",
  })[0];
  const detailHtml = `<table>
    <tr><td><strong>Name</strong></td><td>SMITH, CHEYENNE&nbsp; ALLEN</td></tr>
    <tr><td><strong>Date of Birth</strong></td><td>09/05/1993</td></tr>
    <tr><td><strong>Est. Release Date</strong></td><td>09/03/2030</td></tr>
    <tr><td><strong>Facility</strong></td><td>North Dakota State Penitentiary&nbsp; (701) 328-6100</td></tr>
  </table>`;

  const person = normalizeNorthDakotaDetail(detailHtml, candidate);
  assert.equal(person.externalId, "66681");
  assert.equal(person.records?.[0].caseNumber, "66681");
  assert.equal(person.records?.[0].state, "ND");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.equal(
    person.records?.[0].disposition,
    "Status: Currently incarcerated | Location: North Dakota State Penitentiary (701) 328-6100 | Estimated release: 09/03/2030",
  );
  assert.equal(person.records?.[0].sourceUrl, candidate.detailUrl);
});

test("rejects a North Dakota detail for a different resident name", () => {
  const candidate = parseNorthDakotaCandidates(resultsHtml, {
    firstName: "Cheyenne",
    lastName: "Smith",
    state: "ND",
  })[0];
  assert.throws(
    () => normalizeNorthDakotaDetail("<table><tr><td><strong>Name</strong></td><td>SMITH, OTHER</td></tr></table>", candidate),
    /different resident name/,
  );
});

test("live North Dakota DOCR search returns stable IDs, status, and location", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new NorthDakotaCorrectionsConnector().search({
    firstName: "Cheyenne",
    lastName: "Smith",
    state: "ND",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "cheyenne"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "smith"));
  assert.ok(people.every((person) => /^\d+$/.test(person.externalId ?? "")));
  assert.ok(people.every((person) => /Status: Currently incarcerated \| Location: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.includes(`offenderID=${person.externalId}`)));
});