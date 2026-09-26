import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://services.gdc.ga.gov/GDC/OffenderQuery/jsp/";
const SEARCH_URL = `${BASE_URL}OffQryForm.jsp`;
const RESULTS_URL = `${BASE_URL}OffQryRedirector.jsp`;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

export interface GeorgiaCandidate {
  gdcId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  majorOffense?: string;
  institution?: string;
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const [lastName, givenNames] = value.split(",", 2).map((part) => part.trim());
  const parts = givenNames?.split(/\s+/).filter(Boolean) ?? [];
  if (!lastName || parts.length === 0) return null;
  return {
    firstName: parts[0],
    middleName: parts.slice(1).join(" ") || undefined,
    lastName,
  };
}

function labeledValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<strong\\b[^>]*>\\s*${escaped}:?\\s*<\\/strong>\\s*([^<]*)`, "i"));
  return match ? plainText(match[1]) || undefined : undefined;
}

export function parseGeorgiaCandidates(html: string, query: PersonQuery): GeorgiaCandidate[] {
  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();
  const forms = [...html.matchAll(/<form\b[^>]*name=["']fm\d+["'][^>]*>([\s\S]*?)<\/form>/gi)];

  return forms.flatMap((formMatch): GeorgiaCandidate[] => {
    const form = formMatch[1];
    const gdcId = form.match(/name=["']vRecNo["'][^>]*value=["']([^"']+)["']/i)?.[1]?.trim();
    const fullName = form.match(/<strong\b[^>]*>\s*Offender Name:\s*<\/strong>\s*<b\b[^>]*>([\s\S]*?)<\/b>/i)?.[1];
    const name = fullName ? parseName(plainText(fullName)) : null;
    if (
      !gdcId ||
      !name ||
      name.firstName.toLowerCase() !== requestedFirst ||
      name.lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    return [{
      gdcId,
      ...name,
      majorOffense: labeledValue(form, "Major Offense(s)"),
      institution: labeledValue(form, "Current Institution"),
    }];
  });
}

export function parseGeorgiaDetail(html: string, candidate: GeorgiaCandidate): NormalizedPerson {
  const displayedId = plainText(html.match(/GDC ID:\s*([^<]+)/i)?.[1] ?? "");
  if (displayedId !== candidate.gdcId) throw new Error("Georgia GDC detail returned a different offender ID");

  const year = Number.parseInt(labeledValue(html, "YOB") ?? "", 10);
  const majorOffense = labeledValue(html, "Major Offense") ?? candidate.majorOffense;
  const institution = labeledValue(html, "Most Recent Institution") ?? candidate.institution;
  const status = labeledValue(html, "Current Status");
  const maxRelease = labeledValue(html, "Max Possible Release Date");
  const actualRelease = labeledValue(html, "Actual Release Date");
  const disposition = [
    status ? `Status: ${status}` : null,
    majorOffense ? `Major offense: ${majorOffense}` : null,
    institution ? `Institution: ${institution}` : null,
    maxRelease ? `Max possible release: ${maxRelease}` : null,
    actualRelease ? `Actual release: ${actualRelease}` : null,
  ].filter(Boolean).join(" | ");

  return {
    externalId: candidate.gdcId,
    firstName: candidate.firstName,
    middleName: candidate.middleName,
    lastName: candidate.lastName,
    dobYear: Number.isInteger(year) ? year : undefined,
    source: "georgia_corrections",
    records: [{
      caseNumber: candidate.gdcId,
      courtName: "Georgia Department of Corrections",
      state: "GA",
      caseType: "corrections_record",
      disposition: disposition || undefined,
      sourceUrl: SEARCH_URL,
    }],
  };
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

export class GeorgiaCorrectionsConnector implements Connector {
  sourceName = "georgia_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "GA") return [];

    const cookies = new Map<string, string>();
    const initial = await fetchWithRetry(SEARCH_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!initial.ok) throw new Error(`Georgia GDC disclaimer page failed: ${initial.status}`);
    updateCookies(cookies, initial);
    const disclaimerHtml = await initial.text();
    if (!/name=["']vDisclaimer["'][^>]*value=["']True["']/i.test(disclaimerHtml)) {
      throw new Error("Georgia GDC disclaimer agreement was not found");
    }

    const accepted = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader(cookies),
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        vDisclaimer: "True",
        submit2: "I agree - Go to the Offender Query",
      }),
    });
    if (!accepted.ok) throw new Error(`Georgia GDC disclaimer acceptance failed: ${accepted.status}`);
    updateCookies(cookies, accepted);
    if (!/id=["']OffenderQueryForm["']/i.test(await accepted.text())) {
      throw new Error("Georgia GDC search form was not provided after disclaimer acceptance");
    }

    const search = await fetchWithRetry(RESULTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader(cookies),
        Referer: SEARCH_URL,
      },
      body: new URLSearchParams({
        vIsCookieEnabled: "Y",
        vLastName: query.lastName.trim(),
        vFirstName: query.firstName.trim(),
        vGender: "",
        vRace: "",
        vAgeLow: "",
        vAgeHigh: "",
        vCurrentInstitution: "",
        vAlias: "",
        vMiddleName: "",
        vHeightLow: "",
        vHeightHigh: "",
        vWeightLow: "",
        vWeightHigh: "",
        vEyeColor: "",
        vHairColor: "",
        vSMT: "",
        vSentencedTo: "",
        vOffense: "",
        vCounty: "",
        vOutput: "Detailed",
        vScope: "",
        vListType: "",
        vDetailFormat: "Summary",
        RecordsPerPage: "25",
        vUnoCaseNoRadioButton: "none",
        vOffenderId: "",
        NextPage: "2",
        NextButton: "Submit Form",
      }),
    });
    if (!search.ok) throw new Error(`Georgia GDC search failed: ${search.status}`);
    updateCookies(cookies, search);
    const candidates = parseGeorgiaCandidates(await search.text(), query);

    const people: NormalizedPerson[] = [];
    for (const candidate of candidates) {
      const detail = await fetchWithRetry(RESULTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Cookie: cookieHeader(cookies),
          Referer: RESULTS_URL,
        },
        body: new URLSearchParams({
          vRecNo: candidate.gdcId,
          NextPage: "6",
          btn1: "View Offender Info",
        }),
      });
      if (!detail.ok) throw new Error(`Georgia GDC detail failed: ${detail.status}`);
      updateCookies(cookies, detail);
      people.push(parseGeorgiaDetail(await detail.text(), candidate));
    }
    return people;
  }
}