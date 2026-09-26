import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOregonDetail,
  OregonCorrectionsConnector,
  parseOregonSearchResults,
} from "./oregonCorrections.js";

const resultsHtml = `
  <table>
    <tr><th>SID</th><th>First Name</th><th>Middle Name</th><th>Last Name</th><th>Date of Birth</th></tr>
    <tr>
      <td><a href="#" onclick="document.forms['mainBodyForm']['mainBodyForm:j_idcl'].value='mainBodyForm:foundOffenders:0:j_id27'; document.forms['mainBodyForm'].submit(); return false;">5835726</a></td>
      <td>JOHN</td><td></td><td>SMITH</td><td>09/1960</td>
    </tr>
    <tr>
      <td><a href="#" onclick="document.forms['mainBodyForm']['mainBodyForm:j_idcl'].value='mainBodyForm:foundOffenders:1:j_id27'; document.forms['mainBodyForm'].submit(); return false;">5835726</a></td>
      <td>JOHN</td><td></td><td>SMITH</td><td>09/1960</td>
    </tr>
    <tr>
      <td><a href="#" onclick="document.forms['mainBodyForm']['mainBodyForm:j_idcl'].value='mainBodyForm:foundOffenders:2:j_id27'; document.forms['mainBodyForm'].submit(); return false;">7073668</a></td>
      <td>JOHNNY</td><td>STEVEN</td><td>SMITH</td><td>10/1966</td>
    </tr>
  </table>`;

test("parses and deduplicates exact Oregon OOS result rows", () => {
  const results = parseOregonSearchResults(resultsHtml, { firstName: "John", lastName: "Smith", state: "OR" });

  assert.equal(results.length, 1);
  assert.equal(results[0].sid, "5835726");
  assert.equal(results[0].dobYear, 1960);
  assert.equal(results[0].detailCommand, "mainBodyForm:foundOffenders:0:j_id27");
});

test("normalizes Oregon status and location from the matching SID detail", () => {
  const result = parseOregonSearchResults(resultsHtml, { firstName: "John", lastName: "Smith", state: "OR" })[0];
  const detailHtml = `<table>
    <tr><td>SID# 5835726</td></tr>
    <tr><td>Age:</td><td>65</td><td>DOB:</td><td>09/1960</td><td>Location:</td><td>Oregon State Correctional Institution</td></tr>
    <tr><td>Gender:</td><td>Male</td><td>Race:</td><td>White</td><td>Status:</td><td>AIC</td></tr>
    <tr><td>Height:</td><td>6' 04''</td></tr>
  </table>`;

  const person = normalizeOregonDetail(detailHtml, result);
  assert.equal(person.externalId, "5835726");
  assert.equal(person.records?.[0].caseNumber, "5835726");
  assert.equal(person.records?.[0].state, "OR");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.equal(person.records?.[0].disposition, "Status: AIC | Location: Oregon State Correctional Institution");
  assert.equal(person.records?.[0].sourceUrl, "https://docpub.state.or.us/OOS/intro.jsf");
});

test("rejects a mismatched Oregon detail SID", () => {
  const result = parseOregonSearchResults(resultsHtml, { firstName: "John", lastName: "Smith", state: "OR" })[0];
  assert.throws(() => normalizeOregonDetail("<p>SID# 9999999</p>", result), /detail SID did not match/);
});

test("live Oregon OOS search returns status and location for an exact name", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new OregonCorrectionsConnector().search({
    firstName: "Charles",
    lastName: "Keenan",
    state: "OR",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "charles"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "keenan"));
  assert.ok(people.every((person) => /^\d+$/.test(person.externalId ?? "")));
  assert.ok(people.every((person) => /Status: .+ \| Location: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl === "https://docpub.state.or.us/OOS/intro.jsf"));
});