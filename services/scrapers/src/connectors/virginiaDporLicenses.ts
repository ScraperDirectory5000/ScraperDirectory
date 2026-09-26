import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://dporweb.dpor.virginia.gov/LicenseLookup/AdvancedSearch";
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const normalized = value.trim();
  let lastName: string;
  let givenNames: string[];

  if (normalized.includes(",")) {
    const [last, given] = normalized.split(",", 2).map((part) => part.trim());
    lastName = last;
    givenNames = given?.split(/\s+/).filter(Boolean) ?? [];
  } else {
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    lastName = parts.at(-1) ?? "";
    givenNames = parts.slice(0, -1);
  }

  if (!lastName || givenNames.length === 0) return null;
  return {
    firstName: givenNames[0],
    middleName: givenNames.slice(1).join(" ") || undefined,
    lastName,
  };
}

function addressState(value: string): string | undefined {
  return value.match(/(?:^|,\s*)([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i)?.[1]?.toUpperCase();
}

function addressZip(value: string): string | undefined {
  return value.match(/\b(\d{5}(?:-\d{4})?)\s*$/)?.[1];
}

export function parseVirginiaDporResults(html: string, query: PersonQuery): NormalizedPerson[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 5) return [];

    const licenseNumber = cells[0][1].match(/name=["']license-number["'][^>]*value=["']([^"']+)["']/i)?.[1]
      ?? plainText(cells[0][1]);
    const name = parseName(plainText(cells[1][1]));
    const address = plainText(cells[2][1]);
    const licenseType = plainText(cells[3][1]);
    const board = plainText(cells[4][1]);
    if (
      !licenseNumber ||
      !name ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    return [{
      externalId: licenseNumber,
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      source: "virginia_dpor_licenses",
      addresses: address ? [{
        line1: address,
        state: addressState(address),
        zipCode: addressZip(address),
      }] : undefined,
      records: [{
        caseNumber: licenseNumber,
        courtName: board || "Virginia Department of Professional and Occupational Regulation",
        state: "VA",
        caseType: "professional_license",
        disposition: licenseType || undefined,
        sourceUrl: SEARCH_URL,
      }],
    }];
  });
}

export class VirginiaDporLicensesConnector implements Connector {
  sourceName = "virginia_dpor_licenses";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "VA") return [];

    const response = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Origin: "https://dporweb.dpor.virginia.gov",
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        "search-number": "",
        "search-name": `${query.firstName} ${query.lastName}`,
        "search-location": "",
        "phone-number": "",
      }),
    });
    if (!response.ok) throw new Error(`Virginia DPOR license search failed: ${response.status}`);
    return parseVirginiaDporResults(await response.text(), query);
  }
}