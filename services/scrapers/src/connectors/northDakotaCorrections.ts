import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { readBoundedText } from "./boundedResponse.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://www.nd.gov/docr/offenderlkup/";
const SEARCH_URL = `${BASE_URL}nameprocessor.asp`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

export interface NorthDakotaCandidate {
  residentId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dobYear?: number;
  detailUrl: string;
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

function yearFromDate(value: string): number | undefined {
  const match = value.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function parseNorthDakotaCandidates(html: string, query: PersonQuery): NorthDakotaCandidate[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 5) return [];

    const href = cells[0][1].match(/href=["']([^"']+)["']/i)?.[1];
    const residentId = plainText(cells[0][1]);
    const lastName = plainText(cells[1][1]);
    const firstName = plainText(cells[2][1]);
    const middleName = plainText(cells[3][1]);
    const dob = plainText(cells[4][1]);
    if (
      !/^\d+$/.test(residentId) ||
      !href ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const detailUrl = new URL(href, BASE_URL);
    if (detailUrl.origin !== new URL(BASE_URL).origin || detailUrl.searchParams.get("offenderID") !== residentId) {
      throw new Error("North Dakota DOCR result contained an invalid detail link");
    }

    return [{
      residentId,
      firstName,
      middleName: middleName || undefined,
      lastName,
      dobYear: yearFromDate(dob),
      detailUrl: detailUrl.toString(),
    }];
  });
}

function labeledValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<strong\\b[^>]*>\\s*${escaped}\\s*<\\/strong>[\\s\\S]*?<\\/td>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
  return match ? plainText(match[1]) || undefined : undefined;
}

export function normalizeNorthDakotaDetail(html: string, candidate: NorthDakotaCandidate): NormalizedPerson {
  const displayedName = labeledValue(html, "Name")?.toLowerCase();
  if (
    !displayedName ||
    !displayedName.startsWith(`${candidate.lastName.toLowerCase()}, ${candidate.firstName.toLowerCase()}`)
  ) {
    throw new Error("North Dakota DOCR detail returned a different resident name");
  }

  const facility = labeledValue(html, "Facility");
  if (!facility) throw new Error("North Dakota DOCR detail did not contain a facility");
  const releaseDate = labeledValue(html, "Est. Release Date");
  const disposition = [
    "Status: Currently incarcerated",
    `Location: ${facility}`,
    releaseDate ? `Estimated release: ${releaseDate}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: candidate.residentId,
    firstName: candidate.firstName,
    middleName: candidate.middleName,
    lastName: candidate.lastName,
    dobYear: candidate.dobYear,
    source: "north_dakota_corrections",
    records: [{
      caseNumber: candidate.residentId,
      courtName: "North Dakota Department of Corrections and Rehabilitation",
      state: "ND",
      caseType: "corrections_record",
      disposition,
      sourceUrl: candidate.detailUrl,
    }],
  };
}

export class NorthDakotaCorrectionsConnector implements Connector {
  sourceName = "north_dakota_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "ND") return [];

    const response = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ lastName: query.lastName.trim(), Submit: "Submit" }),
    });
    if (!response.ok) throw new Error(`North Dakota DOCR search failed: ${response.status}`);
    const candidates = parseNorthDakotaCandidates(
      await readBoundedText(response, MAX_RESPONSE_BYTES, "North Dakota DOCR search"),
      query,
    );

    return Promise.all(candidates.map(async (candidate) => {
      const detail = await fetchWithRetry(candidate.detailUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!detail.ok) throw new Error(`North Dakota DOCR detail failed: ${detail.status}`);
      return normalizeNorthDakotaDetail(
        await readBoundedText(detail, MAX_RESPONSE_BYTES, "North Dakota DOCR detail"),
        candidate,
      );
    }));
  }
}