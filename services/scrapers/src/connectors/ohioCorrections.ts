import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://appgateway.drc.ohio.gov";
const SEARCH_URL = `${BASE_URL}/OffenderSearch`;
const SEARCH_POST_URL = `${BASE_URL}/OffenderSearch/Search/SearchResults`;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

export interface OhioCandidate {
  offenderNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
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

function updateCookies(cookies: Map<string, string>, response: Response): void {
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function labeledDefinition(html: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(
    `<dt\\b[^>]*>[\\s\\S]*?${escapedLabel}[\\s\\S]*?<\\/dt>\\s*<dd\\b[^>]*>([\\s\\S]*?)<\\/dd>`,
    "i",
  ));
  return match ? plainText(match[1]) || undefined : undefined;
}

export function parseOhioCandidates(html: string, query: PersonQuery): OhioCandidate[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  const candidates = new Map<string, OhioCandidate>();

  for (const link of html.matchAll(
    /<a\b[^>]*href=["']([^"']*\/OffenderSearch\/Search\/Details\/([ARW]\d{6}))["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const offenderNumber = link[2].toUpperCase();
    const label = plainText(link[3]);
    const nameMatch = label.match(/^([ARW]\d{6})\s*-\s*([^,]+),\s*(.+)$/i);
    if (!nameMatch || nameMatch[1].toUpperCase() !== offenderNumber) continue;

    const lastName = nameMatch[2].trim();
    const givenNames = nameMatch[3].trim().split(/\s+/).filter(Boolean);
    const firstName = givenNames[0];
    if (
      !firstName ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      continue;
    }

    candidates.set(offenderNumber, {
      offenderNumber,
      firstName,
      middleName: givenNames.slice(1).join(" ") || undefined,
      lastName,
      detailUrl: new URL(link[1].replace(/&amp;/gi, "&"), BASE_URL).toString(),
    });
  }

  return [...candidates.values()];
}

export function normalizeOhioDetail(html: string, candidate: OhioCandidate): NormalizedPerson {
  const displayedNumber = labeledDefinition(html, "Number");
  if (displayedNumber !== candidate.offenderNumber) {
    throw new Error(`Ohio DRC detail offender number did not match ${candidate.offenderNumber}`);
  }

  const dob = labeledDefinition(html, "DOB");
  const dobYear = Number.parseInt(dob?.match(/(\d{4})$/)?.[1] ?? "", 10);
  const status = labeledDefinition(html, "Status");
  if (!status) throw new Error(`Ohio DRC detail status was missing for ${candidate.offenderNumber}`);
  const institution = labeledDefinition(html, "Institution");
  const disposition = [
    `Status: ${status}`,
    institution ? `Location: ${institution}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: candidate.offenderNumber,
    firstName: candidate.firstName,
    middleName: candidate.middleName,
    lastName: candidate.lastName,
    dobYear: Number.isInteger(dobYear) ? dobYear : undefined,
    source: "ohio_corrections",
    records: [{
      caseNumber: candidate.offenderNumber,
      courtName: "Ohio Department of Rehabilitation and Correction",
      state: "OH",
      caseType: "corrections_record",
      disposition,
      sourceUrl: candidate.detailUrl,
    }],
  };
}

export class OhioCorrectionsConnector implements Connector {
  sourceName = "ohio_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "OH") return [];

    const cookies = new Map<string, string>();
    const initial = await fetchWithRetry(SEARCH_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!initial.ok) throw new Error(`Ohio DRC search page failed: ${initial.status}`);
    updateCookies(cookies, initial);
    const searchHtml = await initial.text();
    const verificationToken = searchHtml.match(
      /name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i,
    )?.[1];
    if (!verificationToken) throw new Error("Ohio DRC request verification token was not found");

    const submitted = await fetchWithRetry(SEARCH_POST_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader(cookies),
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        __RequestVerificationToken: verificationToken,
        IsAuthenticated: "",
        LastName: query.lastName.trim(),
        FirstName: query.firstName.trim(),
        CntyCommitment: "",
        CntyResidential: "",
        ZipCode: "",
        Status: "A",
        PbDate: "",
        NumPrefix: "A",
        OffNumber: "",
        Sort: "N",
      }),
    });
    if (![302, 303].includes(submitted.status)) {
      throw new Error(`Ohio DRC search submission failed: ${submitted.status}`);
    }
    updateCookies(cookies, submitted);
    const resultLocation = submitted.headers.get("location");
    if (!resultLocation) throw new Error("Ohio DRC search result redirect was missing");

    const searched = await fetchWithRetry(new URL(resultLocation, SEARCH_POST_URL).toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader(cookies),
        Referer: SEARCH_URL,
      },
    });
    if (!searched.ok) throw new Error(`Ohio DRC search results failed: ${searched.status}`);
    updateCookies(cookies, searched);
    const candidates = parseOhioCandidates(await searched.text(), query);

    const people: NormalizedPerson[] = [];
    for (const candidate of candidates) {
      const detail = await fetchWithRetry(candidate.detailUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Cookie: cookieHeader(cookies),
          Referer: searched.url,
        },
      });
      if (!detail.ok) {
        throw new Error(`Ohio DRC detail failed for ${candidate.offenderNumber}: ${detail.status}`);
      }
      people.push(normalizeOhioDetail(await detail.text(), candidate));
    }

    return people;
  }
}