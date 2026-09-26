import assert from "node:assert/strict";
import test from "node:test";
import {
  HHS_OIG_LEIE_DATA_URL,
  HHS_OIG_LEIE_METADATA_URL,
  HHS_OIG_LEIE_SOURCE_WARNING,
  HhsOigLeieBulkAdapter,
  parseHhsOigLeieCsv,
  parseHhsOigLeieMetadata,
  parseRfc4180Csv,
} from "./hhsOigLeie.js";

const HEADER = "LASTNAME,FIRSTNAME,MIDNAME,BUSNAME,GENERAL,SPECIALTY,UPIN,NPI,DOB,ADDRESS,CITY,STATE,ZIP,EXCLTYPE,EXCLDATE,REINDATE,WAIVERDATE,WVRSTATE";
const METADATA_HTML = `
  <html><body>
    <h1>LEIE Database &amp; Supplement Downloads</h1>
    <p>09-10-2026</p><p>Last Update</p>
    <a href="${HHS_OIG_LEIE_DATA_URL}">08-2026 Updated LEIE Database</a>
    <p>The Privacy Act prohibits the distribution of SSNs so regardless of your exact process,
      you'll need to use the Online Search to verify specific individuals and entities.</p>
  </body></html>`;

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(values: readonly string[]): string {
  assert.equal(values.length, 18);
  return values.map(csvField).join(",");
}

test("strict RFC 4180 parser handles commas, escaped quotes, and embedded line endings", () => {
  const parsed = parseRfc4180Csv('A,B,C\r\n"comma, value","say ""hello""","line 1\r\nline 2"\r\n');
  assert.deepEqual(parsed, [
    ["A", "B", "C"],
    ["comma, value", 'say "hello"', "line 1\r\nline 2"],
  ]);
  assert.throws(() => parseRfc4180Csv('A\rB'), /bare carriage return/);
  assert.throws(() => parseRfc4180Csv('A\r\n"unterminated'), /inside a quoted field/);
  assert.throws(() => parseRfc4180Csv('A\r\n"closed"junk'), /after closing quote/);
});

test("normalizes LEIE fields while keeping every identity explicitly unverified", () => {
  const csv = [
    HEADER,
    csvRow([
      "O'NEILL", "SEAN", "P", "", "INDIVIDUAL", "PHYSICIAN", "A12345", "1234567893",
      "19740203", "10 MAIN ST, SUITE 2", "BOSTON", "ma", "02108", "1128a1", "20200319",
      "00000000", "20210105", "ny",
    ]),
    csvRow([
      "", "", "", "1 BEST CARE, INC", "OTHER BUSINESS", "HOME HEALTH AGENCY", "", "0000000000",
      "", "2161 UNIVERSITY AVENUE W, STE", "SAINT PAUL", "MN", "55114", "1128b5", "20230518",
      "00000000", "00000000", "",
    ]),
  ].join("\r\n");

  const result = parseHhsOigLeieCsv(csv);
  assert.equal(result.sourceRowCount, 2);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    source: "hhs_oig_leie",
    sourceRecordId: result.rows[0].sourceRecordId,
    entityKind: "INDIVIDUAL",
    firstName: "SEAN",
    middleName: "P",
    lastName: "O'NEILL",
    businessName: undefined,
    dobYear: 1974,
    address: { street: "10 MAIN ST, SUITE 2", city: "BOSTON", state: "MA", zip: "02108" },
    providerType: "INDIVIDUAL",
    specialty: "PHYSICIAN",
    npi: "1234567893",
    upin: "A12345",
    exclusionType: "1128a1",
    exclusionDate: "2020-03-19",
    reinstatementDate: undefined,
    waiverDate: "2021-01-05",
    waiverState: "NY",
    stableIdentity: { strategy: "NPI", key: "npi:1234567893", verificationStatus: "UNVERIFIED" },
    provenance: {
      officialDataUrl: HHS_OIG_LEIE_DATA_URL,
      officialMetadataUrl: HHS_OIG_LEIE_METADATA_URL,
      sourceWarning: HHS_OIG_LEIE_SOURCE_WARNING,
    },
  });
  assert.equal(result.rows[1].entityKind, "BUSINESS");
  assert.equal(result.rows[1].businessName, "1 BEST CARE, INC");
  assert.equal(result.rows[1].stableIdentity.strategy, "NAME_DOB_EXCLUSION");
  assert.match(result.rows[1].stableIdentity.key, /^name-dob-exclusion:sha256:[a-f0-9]{64}$/);
  assert.match(result.rows[0].sourceRecordId, /^leie:sha256:[a-f0-9]{64}$/);
});

test("prefers UPIN after invalid NPI and creates deterministic normalized fallback identities", () => {
  const makeCsv = (lastName: string, firstName: string, upin: string, npi: string) => [
    HEADER,
    csvRow([
      lastName, firstName, "", "", "INDIVIDUAL", "NURSE", upin, npi, "19800101",
      "", "", "", "", "1128b4", "20240131", "00000000", "00000000", "",
    ]),
  ].join("\r\n");

  const withUpin = parseHhsOigLeieCsv(makeCsv("DIAZ", "ANA", "B98765", "123"));
  assert.deepEqual(withUpin.rows[0].stableIdentity, {
    strategy: "UPIN", key: "upin:B98765", verificationStatus: "UNVERIFIED",
  });
  assert.equal(withUpin.rows[0].npi, undefined);
  assert.equal(withUpin.rejections.invalidNpi, 1);

  const first = parseHhsOigLeieCsv(makeCsv("de la cruz", " Ana ", "", ""));
  const second = parseHhsOigLeieCsv(makeCsv("DE  LA CRUZ", "ANA", "", ""));
  assert.equal(first.rows[0].stableIdentity.strategy, "NAME_DOB_EXCLUSION");
  assert.equal(first.rows[0].stableIdentity.key, second.rows[0].stableIdentity.key);
});

test("fails closed on schema drift and rejects rows with invalid required data", () => {
  assert.throws(() => parseHhsOigLeieCsv(HEADER.replace("NPI", "NPI_NUMBER")), /header mismatch/);
  assert.throws(() => parseHhsOigLeieCsv(`${HEADER}\r\nTOO,FEW,COLUMNS`), /has 3 columns/);

  const result = parseHhsOigLeieCsv([
    HEADER,
    csvRow(["DOE", "JANE", "", "", "INDIVIDUAL", "", "", "", "19800230", "", "", "", "", "1128a1", "20200101", "", "", ""]),
    csvRow(["ROE", "JOHN", "", "", "INDIVIDUAL", "", "", "", "", "", "", "", "", "1128a1", "20200230", "", "", ""]),
    csvRow(["", "", "", "", "INDIVIDUAL", "", "", "", "", "", "", "", "", "1128a1", "20200101", "", "", ""]),
  ].join("\r\n"));
  assert.equal(result.rows.length, 0);
  assert.equal(result.rejections.invalidDate, 2);
  assert.equal(result.rejections.missingName, 1);
});

test("extracts official release metadata and preserves the source warning", () => {
  const metadata = parseHhsOigLeieMetadata(METADATA_HTML);
  assert.equal(metadata.lastUpdated, "2026-09-10");
  assert.equal(metadata.releaseMonth, "2026-08");
  assert.equal(metadata.sourceWarning, HHS_OIG_LEIE_SOURCE_WARNING);
  assert.throws(
    () => parseHhsOigLeieMetadata(METADATA_HTML.replace("The Privacy Act", "A notice")),
    /verification warning/,
  );
});

test("adapter verifies response types and enforces declared and streamed byte bounds", async () => {
  const declaredFetch = async (url: string): Promise<Response> => {
    if (url === HHS_OIG_LEIE_METADATA_URL) {
      return new Response(METADATA_HTML, { headers: { "Content-Type": "text/html" } });
    }
    return new Response("ignored", {
      headers: { "Content-Type": "text/csv", "Content-Length": "9" },
    });
  };
  await assert.rejects(
    new HhsOigLeieBulkAdapter({ maxCsvBytes: 8, fetch: declaredFetch }).download(),
    /exceeds 8 byte limit/,
  );

  const streamedFetch = async (url: string): Promise<Response> => {
    if (url === HHS_OIG_LEIE_METADATA_URL) {
      return new Response(METADATA_HTML, { headers: { "Content-Type": "text/html" } });
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("56789"));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/csv" } });
  };
  await assert.rejects(
    new HhsOigLeieBulkAdapter({ maxCsvBytes: 8, fetch: streamedFetch }).download(),
    /exceeds 8 byte limit/,
  );
  assert.throws(() => new HhsOigLeieBulkAdapter({ maxCsvBytes: 32 * 1024 * 1024 + 1 }), /between 1 and/);
});

test("live official metadata and bounded full LEIE download", {
  skip: process.env.HHS_OIG_LEIE_LIVE_TEST !== "true",
}, async () => {
  const snapshot = await new HhsOigLeieBulkAdapter().download();
  assert.match(snapshot.metadata.lastUpdated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(snapshot.sourceRowCount > 1_000);
  assert.ok(snapshot.rows.length > 1_000);
  assert.ok(snapshot.rows.every((row) => row.stableIdentity.verificationStatus === "UNVERIFIED"));
  assert.ok(snapshot.rows.every((row) => row.provenance.sourceWarning === HHS_OIG_LEIE_SOURCE_WARNING));
});