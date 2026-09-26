import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const BASE_URL = "https://wdoc-loc.wyo.gov";
const SEARCH_URL = `${BASE_URL}/`;
const LIST_URL = `${BASE_URL}/Home/getInmateList`;
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";

interface WyomingOffender {
  offenderID?: unknown;
  docID?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  age?: unknown;
  gender?: unknown;
  groupKind?: unknown;
  fromDB?: unknown;
}

interface WyomingResponse {
  data?: unknown;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return cleanString(value);
}

function detailUrl(offenderID: string, fromDB: string): string {
  const url = new URL("/Home/Detail/", BASE_URL);
  url.searchParams.set("id", offenderID);
  url.searchParams.set("dbType", fromDB);
  return url.toString();
}

export function normalizeWyomingResults(payload: unknown, query: PersonQuery): NormalizedPerson[] {
  const data = (payload as WyomingResponse | null)?.data;
  if (!Array.isArray(data)) return [];

  const requestedFirst = query.firstName.trim().toLowerCase();
  const requestedLast = query.lastName.trim().toLowerCase();

  return data.flatMap((raw): NormalizedPerson[] => {
    if (!raw || typeof raw !== "object") return [];
    const result = raw as WyomingOffender;
    const offenderID = identifier(result.offenderID);
    const docID = identifier(result.docID);
    const firstName = cleanString(result.firstName);
    const lastName = cleanString(result.lastName);
    const fromDB = cleanString(result.fromDB);
    if (
      !offenderID ||
      offenderID === "-1" ||
      !docID ||
      !firstName ||
      !lastName ||
      !fromDB ||
      firstName.toLowerCase() !== requestedFirst ||
      lastName.toLowerCase() !== requestedLast
    ) {
      return [];
    }

    const age = typeof result.age === "number" && Number.isInteger(result.age) && result.age > 0 && result.age < 130
      ? result.age
      : undefined;
    const gender = cleanString(result.gender);
    const groupKind = cleanString(result.groupKind);
    const disposition = [
      groupKind ? `Status: ${groupKind}` : null,
      age ? `Age: ${age}` : null,
      gender ? `Gender: ${gender}` : null,
      `Offender ID: ${offenderID}`,
      `Source system: ${fromDB}`,
    ].filter(Boolean).join(" | ");

    return [{
      externalId: `${fromDB}:${offenderID}`,
      firstName,
      lastName,
      source: "wyoming_corrections",
      records: [{
        caseNumber: docID,
        courtName: "Wyoming Department of Corrections",
        state: "WY",
        caseType: "corrections_record",
        disposition,
        sourceUrl: detailUrl(offenderID, fromDB),
      }],
    }];
  });
}

function requestVerificationToken(html: string): string | undefined {
  const input = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => /\bname\s*=\s*["']__RequestVerificationToken["']/i.test(tag));
  return input?.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1]
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
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

export class WyomingCorrectionsConnector implements Connector {
  sourceName = "wyoming_corrections";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "WY") return [];

    const cookies = new Map<string, string>();
    const initial = await fetchWithRetry(SEARCH_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!initial.ok) throw new Error(`Wyoming WDOC search page failed: ${initial.status}`);
    updateCookies(cookies, initial);
    if (cookies.size === 0) throw new Error("Wyoming WDOC search session cookie was not found");

    const token = requestVerificationToken(await initial.text());
    if (!token) throw new Error("Wyoming WDOC request verification token was not found");

    const form = new URLSearchParams({
      offenderID: "",
      lastName: query.lastName.trim(),
      firstName: "",
      age: "",
      genderGroup: "a",
      __RequestVerificationToken: token,
    });
    const submitted = await fetchWithRetry(SEARCH_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Origin: BASE_URL,
        Referer: SEARCH_URL,
        Cookie: cookieHeader(cookies),
      },
      body: form,
    });
    updateCookies(cookies, submitted);
    if (submitted.status < 200 || submitted.status >= 400) {
      throw new Error(`Wyoming WDOC search failed: ${submitted.status}`);
    }

    const response = await fetchWithRetry(LIST_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Referer: `${BASE_URL}/Home/Search`,
        Cookie: cookieHeader(cookies),
      },
    });
    if (!response.ok) throw new Error(`Wyoming WDOC result list failed: ${response.status}`);
    return normalizeWyomingResults(await response.json(), query);
  }
}