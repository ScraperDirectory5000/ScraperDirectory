import assert from "node:assert/strict";
import test from "node:test";
import { parseAlabamaResults } from "./alabamaCorrections.js";

const resultHtml = `<div class="jet-listing-grid__item" data-post-id="95452">
  <a href="https://www.doc.alabama.gov/inmate/inmate-detail/00328407-2/" aria-label="Inmate AIS 00328407"></a>
  <div class="jet-listing-dynamic-field__content">SMITH, JOHN ANDREW</div>
  <div class="jet-listing-dynamic-field__content">W</div>
  <div class="jet-listing-dynamic-field__content">M</div>
  <div class="jet-listing-dynamic-field__content">1989</div>
  <div class="jet-listing-dynamic-field__content">LIMESTONE CORRECTIONAL CENTER</div>
  <div class="jet-listing-dynamic-field__content">06/11/2034</div>
  <div class="jet-listing-dynamic-field__content">In-House Population</div>
</div>`;

test("normalizes an exact Alabama ADOC result", () => {
  const people = parseAlabamaResults(resultHtml, { firstName: "John", lastName: "Smith", state: "AL" });
  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "00328407");
  assert.equal(people[0].middleName, "ANDREW");
  assert.equal(people[0].dobYear, 1989);
  assert.equal(people[0].records?.[0].state, "AL");
  assert.match(people[0].records?.[0].disposition ?? "", /In-House Population/);
});

test("rejects a non-exact Alabama name", () => {
  assert.deepEqual(parseAlabamaResults(resultHtml, { firstName: "Johnny", lastName: "Smith", state: "AL" }), []);
});