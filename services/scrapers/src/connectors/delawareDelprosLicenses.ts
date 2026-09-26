import type { Connector, NormalizedPerson, PersonQuery } from "../types.js";
import { fetchWithRetry } from "./fetchWithRetry.js";

const SEARCH_URL = "https://delpros.delaware.gov/OH_VerifyLicense";
const REMOTE_URL = "https://delpros.delaware.gov/apexremote";
const DETAIL_URL = "https://delpros.delaware.gov/oh_verifylicensedetails";
const USER_AGENT = "UnnamedFiles/1.0 (contact@unnamedfiles.com)";
const CONTROLLER = "OH_VerifyLicenseCtlr";
const METHOD = "findLicensesForOwner";
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

interface DelprosRow {
  ApplicationType?: unknown;
  Board?: unknown;
  City?: unknown;
  Name?: unknown;
  RecNumber?: unknown;
  State?: unknown;
  Status?: unknown;
  Type?: unknown;
  license?: { v?: { Id?: unknown } };
  returnedDataHasHitLimit?: unknown;
}

interface RemotingMethod {
  name?: unknown;
  ns?: unknown;
  ver?: unknown;
  csrf?: unknown;
  authorization?: unknown;
}

interface RemotingConfig {
  vf?: { vid?: unknown };
  actions?: Record<string, { ms?: RemotingMethod[] }>;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function parseName(value: string): { firstName: string; middleName?: string; lastName: string } | null {
  const commaParts = value.split(",", 2).map((part) => normalizedName(part));
  let parts: string[];
  let lastName: string;

  if (commaParts.length === 2) {
    lastName = commaParts[0];
    parts = commaParts[1].split(" ").filter(Boolean);
  } else {
    parts = normalizedName(value).split(" ").filter(Boolean);
    if (parts.length < 2) return null;
    if (SUFFIXES.has(parts.at(-1) ?? "")) parts.pop();
    lastName = parts.pop() ?? "";
  }

  if (SUFFIXES.has(parts.at(-1) ?? "")) parts.pop();
  if (!lastName || parts.length === 0) return null;
  return {
    firstName: parts[0],
    middleName: parts.slice(1).join(" ") || undefined,
    lastName,
  };
}

function detailUrl(row: DelprosRow): string {
  const licenseId = cleanString(row.license?.v?.Id);
  return licenseId
    ? `${DETAIL_URL}?${new URLSearchParams({ pid: licenseId }).toString()}`
    : SEARCH_URL;
}

export function normalizeDelprosResults(payload: unknown, query: PersonQuery): NormalizedPerson[] {
  if (!Array.isArray(payload)) return [];
  const requestedFirst = normalizedName(query.firstName);
  const requestedLast = normalizedName(query.lastName);

  return payload.flatMap((raw): NormalizedPerson[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as DelprosRow;
    if (row.returnedDataHasHitLimit === true) {
      throw new Error("Delaware DELPROS search was too broad");
    }

    const nameValue = cleanString(row.Name);
    const licenseNumber = cleanString(row.RecNumber);
    const name = nameValue ? parseName(nameValue) : null;
    if (
      !name ||
      !licenseNumber ||
      name.firstName !== requestedFirst ||
      name.lastName !== requestedLast
    ) {
      return [];
    }

    const board = cleanString(row.Board);
    const licenseType = cleanString(row.Type);
    const applicationType = cleanString(row.ApplicationType);
    const status = cleanString(row.Status);
    const city = cleanString(row.City);
    const holderState = cleanString(row.State);
    const caseType = /^(?:APP|L2K)/i.test(licenseNumber)
      ? "professional_license_application"
      : "professional_license";
    const disposition = [
      licenseType ? `Type: ${licenseType}` : null,
      applicationType ? `Application: ${applicationType}` : null,
      status ? `Status: ${status}` : null,
      city ? `Location: ${city}${holderState ? `, ${holderState}` : ""}` : null,
    ].filter(Boolean).join(" | ");

    return [{
      externalId: licenseNumber,
      ...name,
      source: "delaware_delpros_licenses",
      records: [{
        caseNumber: licenseNumber,
        courtName: board ? `Delaware Division of Professional Regulation - ${board}` : "Delaware Division of Professional Regulation",
        state: "DE",
        caseType,
        disposition: disposition || undefined,
        sourceUrl: detailUrl(row),
      }],
    }];
  });
}

function parseRemotingConfig(html: string): { config: RemotingConfig; method: RemotingMethod } {
  const marker = "Visualforce.remoting.Manager.add(new $VFRM.RemotingProviderImpl(";
  const start = html.indexOf(marker);
  const end = start < 0 ? -1 : html.indexOf("));", start + marker.length);
  if (start < 0 || end < 0) throw new Error("Delaware DELPROS remoting configuration was not found");

  const config = JSON.parse(html.slice(start + marker.length, end)) as RemotingConfig;
  const method = config.actions?.[CONTROLLER]?.ms?.find((candidate) => candidate.name === METHOD);
  if (
    !method ||
    typeof config.vf?.vid !== "string" ||
    typeof method.csrf !== "string" ||
    typeof method.authorization !== "string" ||
    typeof method.ver !== "number" ||
    typeof method.ns !== "string"
  ) {
    throw new Error("Delaware DELPROS remoting credentials were incomplete");
  }
  return { config, method };
}

function responseCookies(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

export class DelawareDelprosLicensesConnector implements Connector {
  sourceName = "delaware_delpros_licenses";

  async search(query: PersonQuery): Promise<NormalizedPerson[]> {
    if (query.state !== "DE") return [];

    const initial = await fetchWithRetry(SEARCH_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!initial.ok) throw new Error(`Delaware DELPROS search page failed: ${initial.status}`);
    const cookies = responseCookies(initial);
    const { config, method } = parseRemotingConfig(await initial.text());

    const searchFields = {
      firstName: query.firstName.trim(),
      lastName: query.lastName.trim(),
      middleName: "",
      contactAlias: "",
      board: "",
      licenseType: "",
      licenseNumber: "",
      city: "",
      state: "",
      county: "",
      businessBoard: "",
      businessLicenseType: "",
      businessLicenseNumber: "",
      businessCity: "",
      businessState: "",
      businessCounty: "",
      businessName: "",
      dbafileld: "",
      searchType: "individual",
    };
    const body = {
      action: CONTROLLER,
      method: METHOD,
      data: [searchFields],
      type: "rpc",
      tid: 1,
      ctx: {
        csrf: method.csrf,
        vid: config.vf?.vid,
        ns: method.ns,
        ver: method.ver,
        authorization: method.authorization,
      },
    };
    const response = await fetchWithRetry(REMOTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-User-Agent": "Visualforce-Remoting",
        VFRemote: "1",
        Referer: SEARCH_URL,
        Cookie: cookies,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Delaware DELPROS search failed: ${response.status}`);

    const events = await response.json() as Array<{
      statusCode?: unknown;
      message?: unknown;
      result?: { v?: unknown };
    }>;
    const event = events[0];
    if (event?.statusCode !== 200) {
      throw new Error(`Delaware DELPROS search failed: ${cleanString(event?.message) ?? "invalid response"}`);
    }
    return normalizeDelprosResults(event.result?.v, query);
  }
}