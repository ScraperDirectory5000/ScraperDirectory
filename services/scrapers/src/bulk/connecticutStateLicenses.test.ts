import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTICUT_LICENSES_DATASET_ID,
  CONNECTICUT_LICENSES_DATA_URL,
  CONNECTICUT_LICENSES_METADATA_URL,
  ConnecticutStateLicensesBulkSource,
  buildConnecticutLicensesPageUrl,
  parseConnecticutLicensesPage,
  parseConnecticutPersonName,
} from "./connecticutStateLicenses.js";

const requiredColumns = [
  ["credentialid", "number"], ["name", "text"], ["type", "text"],
  ["fullcredentialcode", "text"], ["credentialtype", "text"],
  ["credentialnumber", "text"], ["credential", "text"], ["status", "text"],
  ["issuedate", "calendar_date"], ["expirationdate", "calendar_date"],
  ["address", "text"], ["city", "text"], ["state", "text"], ["zip", "text"],
  ["recordrefreshedon", "calendar_date"],
].map(([fieldName, dataTypeName]) => ({ fieldName, dataTypeName }));

const metadata = {
  id: CONNECTICUT_LICENSES_DATASET_ID,
  name: "State Licenses and Credentials",
  licenseId: "PUBLIC_DOMAIN",
  rowsUpdatedAt: 1_700_000_000,
  columns: requiredColumns,
};

test("parses source name layouts and suffixes deterministically", () => {
  assert.deepEqual(parseConnecticutPersonName("JAMES H ROBINSON JR"), {
    firstName: "JAMES", middleName: "H", lastName: "ROBINSON", suffix: "JR",
  });
  assert.deepEqual(parseConnecticutPersonName("DE LA CRUZ, ANA MARIA III"), {
    firstName: "ANA", middleName: "MARIA", lastName: "DE LA CRUZ", suffix: "III",
  });
  assert.deepEqual(parseConnecticutPersonName("O'NEILL JR., SEAN P."), {
    firstName: "SEAN", middleName: "P.", lastName: "O'NEILL", suffix: "JR",
  });
  assert.equal(parseConnecticutPersonName("MADONNA"), undefined);
  assert.equal(parseConnecticutPersonName("-- UNKNOWN --"), undefined);
});

test("builds a numeric keyset query without offset", () => {
  const first = new URL(buildConnecticutLicensesPageUrl(undefined, 250));
  assert.equal(first.origin + first.pathname, CONNECTICUT_LICENSES_DATA_URL);
  assert.equal(first.searchParams.get("$where"), "type='INDIVIDUAL'");
  assert.equal(first.searchParams.get("$order"), "credentialid ASC");
  assert.equal(first.searchParams.get("$limit"), "250");
  assert.equal(first.searchParams.has("$offset"), false);

  const next = new URL(buildConnecticutLicensesPageUrl("00042", 1000));
  assert.equal(next.searchParams.get("$where"), "type='INDIVIDUAL' AND credentialid>42");
  assert.throws(() => buildConnecticutLicensesPageUrl("42 OR 1=1", 10), /positive numeric/);
  assert.throws(() => buildConnecticutLicensesPageUrl(undefined, 1001), /between 1 and 1000/);
});

test("normalizes licenses without demographic inference and reports rejected rows", () => {
  const page = parseConnecticutLicensesPage([
    {
      credentialid: "12", name: "JAMES H ROBINSON JR", type: "INDIVIDUAL",
      fullcredentialcode: "PEN.0018965", credentialtype: "PEN", credentialnumber: "018965",
      credential: "PROFESSIONAL ENGINEER", status: "RETIRED",
      issuedate: "2019-02-01T00:00:00.000", expirationdate: "2020-01-31T00:00:00.000",
      address: "272 BAKERS FARM CIR", city: "BRASELTON", state: "ga", zip: "305172592",
      recordrefreshedon: "2020-02-15T00:00:00.000",
    },
    {
      credentialid: "13", name: "SINGLE", type: "INDIVIDUAL",
      credentialtype: "PEN", credential: "ENGINEER", status: "ACTIVE",
    },
    { credentialid: "14", name: "ACME LLC", type: "BUSINESS" },
  ], 3, "11");

  assert.equal(page.rows.length, 1);
  assert.deepEqual(page.rows[0], {
    source: "connecticut_state_licenses",
    sourceRecordId: "12",
    firstName: "JAMES",
    middleName: "H",
    lastName: "ROBINSON",
    suffix: "JR",
    address: { street: "272 BAKERS FARM CIR", city: "BRASELTON", state: "GA", zip: "305172592" },
    credential: {
      type: "PEN", name: "PROFESSIONAL ENGINEER", number: "018965",
      fullCode: "PEN.0018965", status: "RETIRED", issueDate: "2019-02-01",
      expirationDate: "2020-01-31", refreshedDate: "2020-02-15",
    },
  });
  assert.equal("age" in page.rows[0], false);
  assert.equal("dobYear" in page.rows[0], false);
  assert.equal(page.nextCursor, "14");
  assert.equal(page.done, false);
  assert.equal(page.rejections.invalidName, 1);
  assert.equal(page.rejections.nonIndividual, 1);
});

test("rejects unordered pages and counts malformed identifiers and dates", () => {
  const page = parseConnecticutLicensesPage([
    { credentialid: "bad", name: "A B", type: "INDIVIDUAL" },
    {
      credentialid: "20", name: "ANA DIAZ", type: "INDIVIDUAL", credentialtype: "RN",
      credential: "REGISTERED NURSE", status: "ACTIVE", issuedate: "2024-02-30",
    },
  ], 10);
  assert.equal(page.rejections.invalidCredentialId, 1);
  assert.equal(page.rejections.invalidDate, 1);
  assert.equal(page.rows[0].credential?.issueDate, undefined);
  assert.throws(() => parseConnecticutLicensesPage([
    { credentialid: "22", name: "ANA DIAZ", type: "INDIVIDUAL", credentialtype: "RN", credential: "RN", status: "ACTIVE" },
    { credentialid: "21", name: "BOB DIAZ", type: "INDIVIDUAL", credentialtype: "RN", credential: "RN", status: "ACTIVE" },
  ], 10), /strictly ordered/);
});

test("verifies public-domain metadata before fetching a bounded page", async () => {
  const requested: string[] = [];
  const mockFetch = async (url: string): Promise<Response> => {
    requested.push(url);
    if (url === CONNECTICUT_LICENSES_METADATA_URL) return Response.json(metadata);
    return Response.json([{
      credentialid: "101", name: "SARA FOSTER", type: "INDIVIDUAL",
      credentialtype: "RCG", credentialnumber: "210", credential: "REAL ESTATE APPRAISER",
      status: "ACTIVE", recordrefreshedon: "2025-05-28T00:00:00.000",
    }]);
  };
  const source = new ConnecticutStateLicensesBulkSource({ pageSize: 2, maxPageBytes: 4096, fetch: mockFetch });
  const page = await source.fetchPage("100");
  assert.equal(requested[0], CONNECTICUT_LICENSES_METADATA_URL);
  assert.match(requested[1], /credentialid%3E100/);
  assert.equal(page.rows[0].sourceRecordId, "101");
  assert.equal(page.done, true);

  const denied = new ConnecticutStateLicensesBulkSource({
    fetch: async () => Response.json({ ...metadata, licenseId: "RESTRICTED" }),
  });
  await assert.rejects(denied.fetchPage(), /requires PUBLIC_DOMAIN/);
});

test("enforces declared and streamed page byte limits", async () => {
  let requestCount = 0;
  const declaredSource = new ConnecticutStateLicensesBulkSource({
    pageSize: 1,
    maxPageBytes: 8,
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json(metadata);
      return new Response("[123456789]", { headers: { "Content-Length": "11" } });
    },
  });
  await assert.rejects(declaredSource.fetchPage(), /exceeds 8 byte limit/);

  requestCount = 0;
  const streamedSource = new ConnecticutStateLicensesBulkSource({
    pageSize: 1,
    maxPageBytes: 8,
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json(metadata);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("[1234"));
          controller.enqueue(new TextEncoder().encode("56789]"));
          controller.close();
        },
      }));
    },
  });
  await assert.rejects(streamedSource.fetchPage(), /exceeds 8 byte limit/);
  assert.throws(() => new ConnecticutStateLicensesBulkSource({ maxPageBytes: 8 * 1024 * 1024 + 1 }), /between 1 and/);
});

test("live official metadata and first individual page", {
  skip: process.env.CONNECTICUT_LICENSES_LIVE_TEST !== "true",
}, async () => {
  const source = new ConnecticutStateLicensesBulkSource({ pageSize: 2, maxPageBytes: 64 * 1024 });
  const liveMetadata = await source.fetchMetadata();
  assert.equal(liveMetadata.licenseId, "PUBLIC_DOMAIN");
  const page = await source.fetchPage();
  assert.ok(page.rows.length > 0);
  assert.ok(page.rows.every((row) => /^\d+$/.test(row.sourceRecordId)));
});
