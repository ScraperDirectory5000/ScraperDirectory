import assert from "node:assert/strict";
import test from "node:test";
import { parseNevadaDemographics } from "./nevadaCorrections.js";

const demographicTsv = [
  "first_name\tmiddle_name\tlast_name\toffender_id\tgender\tethnic\tapproximate_age\theight_feet\theight_inches\tweight_pounds\tbuild\tcomplexion\thair\teyes\tagy_loc_id\tsec_level\tpri_fel_flag",
  "JOHN\tQ\tPUBLIC\t12345\tM\tCAUCASIAN\t42\t6\t0\t190\tMEDIUM\tFAIR\tBROWN\tBLUE\tPAROLE\tUNASSIGNED\tYES",
  "JOHNNY\t\tPUBLIC\t67890\tM\tCAUCASIAN\t40\t5\t10\t170\tMEDIUM\tFAIR\tBLACK\tBROWN\tINACTIVE-DSCHREL\t\tNO",
].join("\r\n");

test("normalizes an exact Nevada NDOC demographic match", () => {
  const people = parseNevadaDemographics(demographicTsv, {
    firstName: "john",
    lastName: "public",
    state: "NV",
  });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "12345");
  assert.equal(people[0].middleName, "Q");
  assert.equal(people[0].dobYear, undefined);
  assert.equal(people[0].records?.[0].state, "NV");
  assert.equal(people[0].records?.[0].caseType, "corrections_record");
  assert.equal(people[0].records?.[0].sourceUrl, "https://ofdsearch.doc.nv.gov/download_offender_data/demographic.csv");
  assert.equal(
    people[0].records?.[0].disposition,
    "Status/location: PAROLE | Security level: UNASSIGNED | Primary felony: YES | Gender: M"
  );
});

test("rejects partial first-name matches", () => {
  assert.deepEqual(
    parseNevadaDemographics(demographicTsv, { firstName: "Jo", lastName: "Public", state: "NV" }),
    []
  );
});

test("handles a byte-order mark and quoted tab-separated fields", () => {
  const data = "\uFEFFfirst_name\tmiddle_name\tlast_name\toffender_id\tagy_loc_id\n" +
    'JANE\t"ANN"\tDOE\t24680\t"SOUTHERN DESERT CORRECTIONAL CENTER"\n';

  const people = parseNevadaDemographics(data, { firstName: "Jane", lastName: "Doe", state: "NV" });
  assert.equal(people[0].externalId, "24680");
  assert.match(people[0].records?.[0].disposition ?? "", /SOUTHERN DESERT CORRECTIONAL CENTER/);
});