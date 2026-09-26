import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const APPRAISER_API_URL = "https://data.ny.gov/resource/3nr4-s9yt.json";
const APPRAISER_SOURCE_URL = "https://data.ny.gov/d/3nr4-s9yt";
const APPEARANCE_API_URL = "https://data.ny.gov/resource/ucu3-8265.json";
const APPEARANCE_SOURCE_URL = "https://data.ny.gov/d/ucu3-8265";

export interface NewYorkDosAppraiserRow {
  applicant_name?: string;
  uid?: string;
  license_type?: string;
  org_date?: string;
  exp_date?: string;
  prin_bus_name?: string;
  business_city?: string;
  st?: string;
}

export interface NewYorkDosAppearanceRow {
  license_holder_name?: string;
  license_number?: string;
  license_type?: string;
  license_effective_term?: string;
  license_expiration_date?: string;
}

interface ParsedDosName {
  firstName: string;
  middleName?: string;
  lastName: string;
}

function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseExactDosName(value: string | undefined, query: PersonQuery): ParsedDosName | undefined {
  if (!value) return undefined;

  const parts = normalizeNamePart(value).split(" ");
  const requestedFirst = normalizeNamePart(query.firstName);
  const requestedLast = normalizeNamePart(query.lastName);
  if (parts.length < 2 || parts[0] !== requestedLast || parts[1] !== requestedFirst) return undefined;

  return {
    firstName: parts[1],
    middleName: parts.length > 2 ? parts.slice(2).join(" ") : undefined,
    lastName: parts[0],
  };
}

function isoDate(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function joinDetail(parts: Array<string | undefined>): string | undefined {
  const detail = parts.filter((part): part is string => Boolean(part)).join(" | ");
  return detail || undefined;
}

export function normalizeNewYorkDosLicenses(
  appraisers: NewYorkDosAppraiserRow[],
  appearanceLicensees: NewYorkDosAppearanceRow[],
  query: PersonQuery,
): NormalizedPerson[] {
  const normalizedAppraisers = appraisers.flatMap((row): NormalizedPerson[] => {
    const name = parseExactDosName(row.applicant_name, query);
    if (!name || !row.uid) return [];

    return [{
      externalId: row.uid,
      ...name,
      source: "new_york_dos_licenses",
      records: [{
        caseNumber: row.uid,
        courtName: "New York State Department of State",
        state: "NY",
        caseType: "professional_license",
        filingDate: isoDate(row.org_date),
        disposition: joinDetail([
          row.license_type,
          "Status: Active",
          row.exp_date ? `Expires: ${isoDate(row.exp_date)}` : undefined,
          row.prin_bus_name ? `Business: ${row.prin_bus_name}` : undefined,
          row.business_city ? `Business location: ${row.business_city}, ${row.st ?? ""}`.trim().replace(/,$/, "") : undefined,
        ]),
        sourceUrl: APPRAISER_SOURCE_URL,
      }],
    }];
  });

  const normalizedAppearanceLicensees = appearanceLicensees.flatMap((row): NormalizedPerson[] => {
    const name = parseExactDosName(row.license_holder_name, query);
    if (!name || !row.license_number) return [];

    return [{
      externalId: row.license_number,
      ...name,
      source: "new_york_dos_licenses",
      records: [{
        caseNumber: row.license_number,
        courtName: "New York State Department of State",
        state: "NY",
        caseType: "professional_license",
        filingDate: isoDate(row.license_effective_term),
        disposition: joinDetail([
          row.license_type,
          "Status: Active",
          row.license_expiration_date ? `Expires: ${isoDate(row.license_expiration_date)}` : undefined,
        ]),
        sourceUrl: APPEARANCE_SOURCE_URL,
      }],
    }];
  });

  return [...normalizedAppraisers, ...normalizedAppearanceLicensees];
}

function buildNameQuery(field: string, query: PersonQuery, select: string): string {
  const prefix = `${normalizeNamePart(query.lastName)} ${normalizeNamePart(query.firstName)}`.replaceAll("'", "''");
  return new URLSearchParams({
    "$select": select,
    "$where": `upper(${field}) like '${prefix}%'`,
    "$limit": "50",
  }).toString();
}

async function fetchRows<T>(url: string): Promise<T[]> {
  const headers: Record<string, string> = {
    "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
  };
  if (process.env.NEW_YORK_OPEN_DATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.NEW_YORK_OPEN_DATA_APP_TOKEN;
  }

  const response = await fetchWithRetry(url, { headers });
  if (!response.ok) throw new Error(`New York Open Data request failed: ${response.status}`);
  return (await response.json()) as T[];
}

export class NewYorkDosLicensesConnector implements Connector {
  sourceName = "new_york_dos_licenses";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "NY") return [];

    const appraiserQuery = buildNameQuery(
      "applicant_name",
      query,
      "applicant_name,uid,license_type,org_date,exp_date,prin_bus_name,business_city,st",
    );
    const appearanceQuery = buildNameQuery(
      "license_holder_name",
      query,
      "license_holder_name,license_number,license_type,license_effective_term,license_expiration_date",
    );
    const [appraisers, appearanceLicensees] = await Promise.all([
      fetchRows<NewYorkDosAppraiserRow>(`${APPRAISER_API_URL}?${appraiserQuery}`),
      fetchRows<NewYorkDosAppearanceRow>(`${APPEARANCE_API_URL}?${appearanceQuery}`),
    ]);

    return normalizeNewYorkDosLicenses(appraisers, appearanceLicensees, query);
  }
}