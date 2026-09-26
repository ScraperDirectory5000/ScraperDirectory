import assert from "node:assert/strict";
import test from "node:test";
import { parseVirginiaDporResults, VirginiaDporLicensesConnector } from "./virginiaDporLicenses.js";

const resultsHtml = `<table>
  <tr><th>License Number</th><th>Name</th><th>Address</th><th>License Type</th><th>Board</th></tr>
  <tr>
    <td><form action="LicenseDetail" method="post"><input name="license-number" type="hidden" value="2705061013"><input type="submit" value="2705061013"></form></td>
    <td>JOHN SMITH</td><td>11141 SUNFIELD DRIVE, MIDLOTHIAN, VA 23112</td><td>Contractor</td><td>Board for Contractors</td>
  </tr>
  <tr>
    <td><form><input name="license-number" value="0401015792"></form></td>
    <td>SMITH, JOHN STATON</td><td>LAUREL SPRINGS, NJ 08021</td><td>Architect License</td><td>Board for APELSCIDLA</td>
  </tr>
  <tr><td>999</td><td>JOHNNY SMITH</td><td>RICHMOND, VA 23219</td><td>Other</td><td>Other Board</td></tr>
</table>`;

test("normalizes exact Virginia DPOR license results", () => {
  const people = parseVirginiaDporResults(resultsHtml, { firstName: "John", lastName: "Smith", state: "VA" });

  assert.equal(people.length, 2);
  assert.equal(people[0].externalId, "2705061013");
  assert.equal(people[0].addresses?.[0].state, "VA");
  assert.equal(people[0].addresses?.[0].zipCode, "23112");
  assert.equal(people[0].records?.[0].state, "VA");
  assert.equal(people[0].records?.[0].caseType, "professional_license");
  assert.equal(people[0].records?.[0].sourceUrl, "https://dporweb.dpor.virginia.gov/LicenseLookup/AdvancedSearch");
  assert.equal(people[1].middleName, "STATON");
});

test("rejects partial Virginia DPOR names", () => {
  assert.deepEqual(
    parseVirginiaDporResults(resultsHtml, { firstName: "Johnny", lastName: "Smit", state: "VA" }),
    []
  );
});

test("live Virginia DPOR search returns exact names with stable license IDs", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new VirginiaDporLicensesConnector().search({
    firstName: "John",
    lastName: "Smith",
    state: "VA",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName.toLowerCase() === "john"));
  assert.ok(people.every((person) => person.lastName.toLowerCase() === "smith"));
  assert.ok(people.every((person) => Boolean(person.externalId)));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.startsWith("https://dporweb.dpor.virginia.gov/")));
});