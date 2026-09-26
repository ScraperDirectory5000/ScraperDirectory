import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOhioDetail,
  OhioCorrectionsConnector,
  parseOhioCandidates,
} from "./ohioCorrections.js";

const resultsHtml = `
  <div class="row black-border table-striped">
    <a href="/OffenderSearch/Search/Details/A408018">A408018 - SMITH, JOHN DAVID</a>
  </div>
  <div class="mobile-result">
    <a href="/OffenderSearch/Search/Details/A408018">A408018 - SMITH, JOHN DAVID</a>
  </div>
  <div class="row black-border table-striped">
    <a href="/OffenderSearch/Search/Details/A678482">A678482 - SMITH, JOHNNY A</a>
  </div>`;

const detailHtml = `
  <div class="panel panel-primary">
    <div class="panel-heading text-center"><strong>JOHN DAVID SMITH</strong></div>
    <div class="panel-body"><dl class="dl-horizontal">
      <dt><label for="OffenderInfo_OffId">Number</label></dt><dd>A408018</dd>
      <dt><label for="OffenderInfo_DobDt">DOB</label></dt><dd>04/02/1951</dd>
      <dt><a href="/institutions">Institution</a></dt><dd>Marion Correctional Institution</dd>
      <dt><label for="OffenderInfo_Stats">Status</label></dt><dd><span>INCARCERATED</span></dd>
    </dl></div>
  </div>`;

test("parses, deduplicates, and exact-name filters Ohio result links", () => {
  const candidates = parseOhioCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "OH",
  });

  assert.deepEqual(candidates, [{
    offenderNumber: "A408018",
    firstName: "JOHN",
    middleName: "DAVID",
    lastName: "SMITH",
    detailUrl: "https://appgateway.drc.ohio.gov/OffenderSearch/Search/Details/A408018",
  }]);
});

test("normalizes Ohio ID, DOB year, status, location, and official detail URL", () => {
  const candidate = parseOhioCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "OH",
  })[0];
  const person = normalizeOhioDetail(detailHtml, candidate);

  assert.equal(person.externalId, "A408018");
  assert.equal(person.dobYear, 1951);
  assert.equal(person.source, "ohio_corrections");
  assert.equal(person.records?.[0].caseNumber, "A408018");
  assert.equal(person.records?.[0].state, "OH");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.equal(
    person.records?.[0].disposition,
    "Status: INCARCERATED | Location: Marion Correctional Institution",
  );
  assert.equal(
    person.records?.[0].sourceUrl,
    "https://appgateway.drc.ohio.gov/OffenderSearch/Search/Details/A408018",
  );
});

test("rejects an Ohio detail page for a different offender number", () => {
  const candidate = parseOhioCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "OH",
  })[0];
  assert.throws(
    () => normalizeOhioDetail(detailHtml.replaceAll("A408018", "A999999"), candidate),
    /detail offender number did not match/,
  );
});

test("live Ohio DRC search returns official fields for an exact name", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new OhioCorrectionsConnector().search({
    firstName: "John",
    lastName: "Smith",
    state: "OH",
  });

  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "john"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "smith"));
  assert.ok(people.every((person) => /^[ARW]\d{6}$/.test(person.externalId ?? "")));
  assert.ok(people.every((person) => Number.isInteger(person.dobYear)));
  assert.ok(people.every((person) => /^Status: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.some((person) => /\| Location: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.endsWith(person.externalId ?? "")));
});