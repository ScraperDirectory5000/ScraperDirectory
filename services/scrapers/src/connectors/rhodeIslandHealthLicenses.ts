import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { readBoundedText } from "./boundedResponse.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://datahealth.ri.gov/find/licensees/refreshTbl.php";
const LIST_URL = "https://datahealth.ri.gov/lists/licensees/getList.php";
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_LIST_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 100;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

export interface RhodeIslandLicenseCandidate {
  licenseNumber: string;
  profession: string;
  licenseType: string;
  sourceUrl: string;
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function htmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

export function parseRhodeIslandSearch(html: string, query: PersonQuery): RhodeIslandLicenseCandidate[] {
  const expectedName = `${normalizedName(query.lastName)} ${normalizedName(query.firstName)}`;
  const resultCount = Number.parseInt(plainText(html).match(/of\s+([\d,]+)\s+records/i)?.[1]?.replaceAll(",", "") ?? "0", 10);
  if (resultCount > MAX_SEARCH_RESULTS) {
    throw new Error(`Rhode Island DOH exact-name search exceeded ${MAX_SEARCH_RESULTS} results`);
  }

  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 6) return [];

    const fullName = normalizedName(plainText(cells[0][1]));
    const href = cells[0][1].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || (fullName !== expectedName && !fullName.startsWith(`${expectedName} `))) return [];

    const sourceUrl = new URL(htmlAttribute(href), "https://health.ri.gov/");
    const licenseNumber = sourceUrl.searchParams.get("license")?.trim();
    const profession = plainText(cells[1][1]);
    const licenseType = plainText(cells[2][1]);
    if (
      sourceUrl.origin !== "https://health.ri.gov" ||
      sourceUrl.pathname !== "/find/licensees/results.php" ||
      !licenseNumber ||
      !profession ||
      !licenseType
    ) {
      return [];
    }

    return [{ licenseNumber, profession, licenseType, sourceUrl: sourceUrl.toString() }];
  });
}

function parseCsv(data: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];
    if (character === '"') {
      if (quoted && data[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && data[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((field) => field.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function extractCsv(html: string): string {
  const marker = "outputQry = `";
  const start = html.indexOf(marker);
  const end = start < 0 ? -1 : html.indexOf("`;\nvar numbRows", start + marker.length);
  if (start < 0 || end < 0) throw new Error("Rhode Island DOH downloadable-list data was not found");
  return html.slice(start + marker.length, end);
}

function isoDate(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : undefined;
}

export function normalizeRhodeIslandList(
  html: string,
  query: PersonQuery,
  candidates: RhodeIslandLicenseCandidate[],
): NormalizedPerson[] {
  const rows = parseCsv(extractCsv(html));
  const headers = rows.shift();
  if (!headers) return [];
  const candidateByLicense = new Map(candidates.map((candidate) => [candidate.licenseNumber, candidate]));
  const requestedFirst = normalizedName(query.firstName);
  const requestedLast = normalizedName(query.lastName);

  return rows.flatMap((fields): NormalizedPerson[] => {
    const row = Object.fromEntries(headers.map((header, index) => [header, fields[index]?.trim() ?? ""]));
    const candidate = candidateByLicense.get(row["License No"]);
    const firstName = normalizedName(row.First ?? "");
    const lastName = normalizedName(row.Last ?? "");
    if (!candidate || firstName !== requestedFirst || lastName !== requestedLast || row.Status !== "Active") return [];

    const middleName = normalizedName(row.Middle ?? "");
    const location = [row.City, row.State, row.Zip].filter(Boolean).join(" ");
    const disposition = [
      row["License Type"] ? `Type: ${row["License Type"]}` : null,
      `Status: ${row.Status}`,
      row.Specialty ? `Specialty: ${row.Specialty}` : null,
      row["Expiration Date"] ? `Expires: ${isoDate(row["Expiration Date"]) ?? row["Expiration Date"]}` : null,
      location ? `Location: ${location}` : null,
    ].filter(Boolean).join(" | ");
    const addressLine1 = row["Address Line 1"];

    return [{
      externalId: candidate.licenseNumber,
      firstName,
      middleName: middleName || undefined,
      lastName,
      source: "rhode_island_health_licenses",
      addresses: addressLine1 ? [{
        line1: addressLine1,
        line2: [row["Address Line 2"], row["Address Line 3"]].filter(Boolean).join(", ") || undefined,
        city: row.City || undefined,
        state: row.State || undefined,
        zipCode: row.Zip || undefined,
      }] : undefined,
      records: [{
        caseNumber: candidate.licenseNumber,
        courtName: `Rhode Island Department of Health - ${candidate.profession}`,
        state: "RI",
        caseType: "professional_license",
        filingDate: isoDate(row["Issue Date"]),
        disposition,
        sourceUrl: candidate.sourceUrl,
      }],
    }];
  });
}

export class RhodeIslandHealthLicensesConnector implements Connector {
  sourceName = "rhode_island_health_licenses";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "RI") return [];

    const search = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        jxName: `${query.lastName.trim()}  ${query.firstName.trim()}`,
        jxProfession: "",
        jxLicense: "",
        jxSpecialty: "",
        jxCity: "",
        jxState: "",
        numbRecs: String(MAX_SEARCH_RESULTS),
        page: "1",
      }),
    });
    if (!search.ok) throw new Error(`Rhode Island DOH license search failed: ${search.status}`);
    const candidates = parseRhodeIslandSearch(
      await readBoundedText(search, MAX_SEARCH_BYTES, "Rhode Island DOH license search"),
      query,
    );
    if (candidates.length === 0) return [];

    const groups = new Map<string, RhodeIslandLicenseCandidate[]>();
    for (const candidate of candidates) {
      const key = `${candidate.profession}\0${candidate.licenseType}`;
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }

    const results = await Promise.all([...groups.values()].map(async (group) => {
      const list = await fetchWithRetry(LIST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({
          jxProfession: group[0].profession,
          jxLicense: group[0].licenseType,
        }),
      });
      if (!list.ok) throw new Error(`Rhode Island DOH downloadable list failed: ${list.status}`);
      const html = await readBoundedText(list, MAX_LIST_BYTES, "Rhode Island DOH downloadable list");
      return normalizeRhodeIslandList(html, query, group);
    }));

    return results.flat();
  }
}