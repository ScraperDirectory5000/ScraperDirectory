import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGeorgiaCandidates,
  parseGeorgiaDetail,
} from "./georgiaCorrections.js";

const resultsHtml = `<form name="fm1" action="OffQryRedirector.jsp" method="POST">
  <input name="vRecNo" type="hidden" value="0000742143">
  <input type="hidden" name="NextPage" value="6">
  <div><strong>Offender Name:</strong><b> SMITH, JOHN ALLEN </b></div>
  <div><strong>Major Offense(s):</strong><b> MURDER </b></div>
  <div><strong>Current Institution:</strong><b> WASHINGTON STATE PRISON </b></div>
</form>`;

const detailHtml = `<h4>NAME: SMITH, JOHN ALLEN</h4>
<h5>GDC ID: 0000742143</h5>
<p><strong class="offender">YOB:</strong> 1973<br />
<strong class="offender">MAJOR OFFENSE:</strong> MURDER<br />
<strong class="offender">MOST RECENT INSTITUTION:</strong> WASHINGTON STATE PRISON<br />
<strong class="offender">MAX POSSIBLE RELEASE DATE:</strong> LIFE<br />
<strong class="offender">ACTUAL RELEASE DATE:</strong> CURRENTLY SERVING&nbsp;<br />
<strong class="offender">CURRENT STATUS:</strong> ACTIVE&nbsp;<br /></p>`;

test("normalizes an exact Georgia GDC candidate and detail", () => {
  const candidates = parseGeorgiaCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "GA",
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].gdcId, "0000742143");
  assert.equal(candidates[0].middleName, "ALLEN");

  const person = parseGeorgiaDetail(detailHtml, candidates[0]);
  assert.equal(person.externalId, "0000742143");
  assert.equal(person.dobYear, 1973);
  assert.equal(person.records?.[0].state, "GA");
  assert.equal(person.records?.[0].caseType, "corrections_record");
  assert.match(person.records?.[0].disposition ?? "", /Status: ACTIVE/);
  assert.match(person.records?.[0].disposition ?? "", /Institution: WASHINGTON STATE PRISON/);
  assert.equal(
    person.records?.[0].sourceUrl,
    "https://services.gdc.ga.gov/GDC/OffenderQuery/jsp/OffQryForm.jsp",
  );
});

test("rejects partial Georgia GDC names", () => {
  assert.deepEqual(
    parseGeorgiaCandidates(resultsHtml, { firstName: "Johnny", lastName: "Smith", state: "GA" }),
    [],
  );
  assert.deepEqual(
    parseGeorgiaCandidates(resultsHtml, { firstName: "John", lastName: "Smit", state: "GA" }),
    [],
  );
});

test("rejects a detail response for a different offender ID", () => {
  const candidate = parseGeorgiaCandidates(resultsHtml, {
    firstName: "John",
    lastName: "Smith",
    state: "GA",
  })[0];

  assert.throws(
    () => parseGeorgiaDetail(detailHtml.replace("0000742143", "0000000001"), candidate),
    /different offender ID/,
  );
});