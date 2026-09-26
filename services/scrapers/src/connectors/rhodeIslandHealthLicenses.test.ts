import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRhodeIslandList,
  parseRhodeIslandSearch,
  RhodeIslandHealthLicensesConnector,
} from "./rhodeIslandHealthLicenses.js";

const searchHtml = `<table><tbody>
  <tr><td><a href="https://health.ri.gov/find/licensees/results.php?id=1697&amp;license=DA00504&amp;prof=248">AGUIRRE MASHA</a></td><td>Acupuncture</td><td>Doctor of Acupuncture</td><td></td><td>PROVIDENCE</td><td>RI</td></tr>
  <tr><td><a href="https://health.ri.gov/find/licensees/results.php?id=1698&amp;license=DA00999&amp;prof=248">AGUIRRE MASHALI</a></td><td>Acupuncture</td><td>Doctor of Acupuncture</td><td></td><td>PROVIDENCE</td><td>RI</td></tr>
</tbody></table><p>Showing: 1 to 2 of 2 records.</p>`;

const csv = `"Name","First","Middle","Last","Owner Manager Name","License No","Profession","License Type","Status","Issue Date","Specialty","Expiration Date","Address Line 1","Address Line 2","Address Line 3","City","State","Zip","Phone","Fax"
"AGUIRRE  MASHA","MASHA","","AGUIRRE","","DA00504","Acupuncture","Doctor of Acupuncture","Active","05/31/2023","","02/01/2027","208 GOVERNOR ST","FLOOR 1","","PROVIDENCE","RI","02906","",""
"AGUIRRE  MASHALI","MASHALI","","AGUIRRE","","DA00999","Acupuncture","Doctor of Acupuncture","Active","01/01/2020","","02/01/2027","1 OTHER ST","","","PROVIDENCE","RI","02901","",""`;
const listHtml = `<table></table><script>var outputQry = \`${csv}\`;
var numbRows = '2';</script>`;

test("parses only exact Rhode Island license search results with provider IDs", () => {
  const candidates = parseRhodeIslandSearch(searchHtml, {
    firstName: "Masha",
    lastName: "Aguirre",
    state: "RI",
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].licenseNumber, "DA00504");
  assert.equal(candidates[0].profession, "Acupuncture");
  assert.equal(candidates[0].licenseType, "Doctor of Acupuncture");
  assert.equal(
    candidates[0].sourceUrl,
    "https://health.ri.gov/find/licensees/results.php?id=1697&license=DA00504&prof=248",
  );
});

test("normalizes a matching active Rhode Island downloadable-list row", () => {
  const query = { firstName: "Masha", lastName: "Aguirre", state: "RI" };
  const candidates = parseRhodeIslandSearch(searchHtml, query);
  const people = normalizeRhodeIslandList(listHtml, query, candidates);

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "DA00504");
  assert.equal(people[0].addresses?.[0].line1, "208 GOVERNOR ST");
  assert.equal(people[0].addresses?.[0].state, "RI");
  assert.equal(people[0].records?.[0].caseNumber, "DA00504");
  assert.equal(people[0].records?.[0].state, "RI");
  assert.equal(people[0].records?.[0].caseType, "professional_license");
  assert.equal(people[0].records?.[0].filingDate, "2023-05-31");
  assert.match(people[0].records?.[0].disposition ?? "", /Status: Active/);
  assert.match(people[0].records?.[0].disposition ?? "", /Location: PROVIDENCE RI 02906/);
});

test("rejects inactive, mismatched, and over-broad Rhode Island responses", () => {
  const query = { firstName: "Masha", lastName: "Aguirre", state: "RI" };
  const candidates = parseRhodeIslandSearch(searchHtml, query);
  assert.deepEqual(
    normalizeRhodeIslandList(listHtml.replace('"Active"', '"Expired"'), query, candidates),
    [],
  );
  assert.deepEqual(parseRhodeIslandSearch(searchHtml, {
    firstName: "Mash",
    lastName: "Aguirre",
    state: "RI",
  }), []);
  assert.throws(
    () => parseRhodeIslandSearch(searchHtml.replace("of 2 records", "of 101 records"), query),
    /exceeded 100 results/,
  );
});

test("live Rhode Island DOH search confirms an active license number and location", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new RhodeIslandHealthLicensesConnector().search({
    firstName: "Masha",
    lastName: "Aguirre",
    state: "RI",
  });
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.firstName === "MASHA"));
  assert.ok(people.every((person) => person.lastName === "AGUIRRE"));
  assert.ok(people.every((person) => person.externalId === person.records?.[0].caseNumber));
  assert.ok(people.every((person) => /Status: Active/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => /Location: .+/.test(person.records?.[0].disposition ?? "")));
  assert.ok(people.every((person) => person.records?.[0].sourceUrl?.startsWith("https://health.ri.gov/find/licensees/results.php?")));
});