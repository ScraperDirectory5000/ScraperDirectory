import { readBoundedText } from "../connectors/boundedResponse.js";
import { fetchWithRetry } from "../connectors/fetchWithRetry.js";
import type {
  BulkPage,
  BulkPersonRow,
  BulkRejectionCounters,
  BulkSource,
  BulkSourceMetadata,
} from "./types.js";

export const CONNECTICUT_LICENSES_DATASET_ID = "ngch-56tr";
export const CONNECTICUT_LICENSES_METADATA_URL =
  `https://data.ct.gov/api/views/${CONNECTICUT_LICENSES_DATASET_ID}`;
export const CONNECTICUT_LICENSES_DATA_URL =
  `https://data.ct.gov/resource/${CONNECTICUT_LICENSES_DATASET_ID}.json`;

const SOURCE_NAME = "connecticut_state_licenses";
const REQUIRED_COLUMNS = new Set([
  "credentialid",
  "name",
  "type",
  "fullcredentialcode",
  "credentialtype",
  "credentialnumber",
  "credential",
  "status",
  "issuedate",
  "expirationdate",
  "address",
  "city",
  "state",
  "zip",
  "recordrefreshedon",
]);
const SELECT_COLUMNS = [...REQUIRED_COLUMNS].join(",");
const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGE_SIZE = 1_000;
const DEFAULT_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const SUFFIXES = new Map([
  ["JR", "JR"],
  ["JUNIOR", "JR"],
  ["SR", "SR"],
  ["SENIOR", "SR"],
  ["II", "II"],
  ["III", "III"],
  ["IV", "IV"],
  ["V", "V"],
  ["2ND", "II"],
  ["3RD", "III"],
  ["4TH", "IV"],
]);

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface SocrataMetadata {
  id?: unknown;
  name?: unknown;
  licenseId?: unknown;
  rowsUpdatedAt?: unknown;
  columns?: unknown;
}

interface SocrataColumn {
  fieldName?: unknown;
  dataTypeName?: unknown;
}

interface SocrataLicenseRow {
  credentialid?: unknown;
  name?: unknown;
  type?: unknown;
  fullcredentialcode?: unknown;
  credentialtype?: unknown;
  credentialnumber?: unknown;
  credential?: unknown;
  status?: unknown;
  issuedate?: unknown;
  expirationdate?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  recordrefreshedon?: unknown;
}

export interface ParsedPersonName {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
}

export interface ConnecticutStateLicensesOptions {
  pageSize?: number;
  maxPageBytes?: number;
  appToken?: string;
  fetch?: FetchLike;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function suffixFrom(value: string): string | undefined {
  return SUFFIXES.get(value.replace(/[.,]/g, "").toUpperCase());
}

function validNamePart(value: string): boolean {
  return /^[\p{L}][\p{L}\p{M}'’.-]*(?: [\p{L}][\p{L}\p{M}'’.-]*)*$/u.test(value);
}

export function parseConnecticutPersonName(value: unknown): ParsedPersonName | undefined {
  const name = cleanText(value);
  if (!name) return undefined;

  const commaParts = name.split(",").map((part) => part.trim());
  if (commaParts.length > 2 || commaParts.some((part) => !part)) return undefined;

  let firstName: string;
  let middleParts: string[];
  let lastName: string;
  let suffix: string | undefined;

  if (commaParts.length === 2) {
    const familyParts = commaParts[0].split(/\s+/);
    const givenParts = commaParts[1].split(/\s+/);
    suffix = suffixFrom(familyParts.at(-1) ?? "");
    if (suffix) familyParts.pop();
    if (!suffix) {
      suffix = suffixFrom(givenParts.at(-1) ?? "");
      if (suffix) givenParts.pop();
    }
    if (familyParts.length === 0 || givenParts.length === 0) return undefined;
    firstName = givenParts.shift()!;
    middleParts = givenParts;
    lastName = familyParts.join(" ");
  } else {
    const parts = commaParts[0].split(/\s+/);
    suffix = suffixFrom(parts.at(-1) ?? "");
    if (suffix) parts.pop();
    if (parts.length < 2) return undefined;
    firstName = parts.shift()!;
    lastName = parts.pop()!;
    middleParts = parts;
  }

  const middleName = middleParts.length > 0 ? middleParts.join(" ") : undefined;
  if (![firstName, lastName, middleName].filter(Boolean).every((part) => validNamePart(part!))) {
    return undefined;
  }
  return { firstName, middleName, lastName, suffix };
}

function parseCredentialId(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text || !/^\d+$/.test(text)) return undefined;
  const id = BigInt(text);
  return id > 0n ? id.toString() : undefined;
}

function parseDate(value: unknown, rejections: BulkRejectionCounters): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (!match) {
    rejections.invalidDate += 1;
    return undefined;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    rejections.invalidDate += 1;
    return undefined;
  }
  return `${year}-${month}-${day}`;
}

function emptyRejections(): BulkRejectionCounters {
  return {
    nonIndividual: 0,
    missingCredentialId: 0,
    invalidCredentialId: 0,
    invalidName: 0,
    missingCredential: 0,
    invalidDate: 0,
  };
}

export function buildConnecticutLicensesPageUrl(cursor: string | undefined, pageSize: number): string {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  const normalizedCursor = cursor === undefined ? undefined : parseCredentialId(cursor);
  if (cursor !== undefined && normalizedCursor === undefined) {
    throw new TypeError("cursor must be a positive numeric credential ID");
  }
  const where = [
    "type='INDIVIDUAL'",
    ...(normalizedCursor ? [`credentialid>${normalizedCursor}`] : []),
  ].join(" AND ");
  const params = new URLSearchParams({
    "$select": SELECT_COLUMNS,
    "$where": where,
    "$order": "credentialid ASC",
    "$limit": String(pageSize),
  });
  return `${CONNECTICUT_LICENSES_DATA_URL}?${params.toString()}`;
}

export function parseConnecticutLicensesPage(
  payload: unknown,
  pageSize: number,
  cursor?: string,
): BulkPage {
  if (!Array.isArray(payload)) throw new TypeError("Connecticut licenses returned a non-array payload");
  if (payload.length > pageSize) throw new Error(`Connecticut licenses exceeded the ${pageSize}-row page limit`);

  const rejections = emptyRejections();
  const rows: BulkPersonRow[] = [];
  let lastId = cursor ? BigInt(cursor) : 0n;
  let advancedCursor = false;

  for (const item of payload as SocrataLicenseRow[]) {
    if (item.credentialid === undefined || item.credentialid === null || cleanText(item.credentialid) === undefined) {
      rejections.missingCredentialId += 1;
      continue;
    }
    const sourceRecordId = parseCredentialId(item.credentialid);
    if (!sourceRecordId) {
      rejections.invalidCredentialId += 1;
      continue;
    }
    const numericId = BigInt(sourceRecordId);
    if (numericId <= lastId) throw new Error("Connecticut licenses page is not strictly ordered by credentialid");
    lastId = numericId;
    advancedCursor = true;
    if (cleanText(item.type)?.toUpperCase() !== "INDIVIDUAL") {
      rejections.nonIndividual += 1;
      continue;
    }

    const name = parseConnecticutPersonName(item.name);
    if (!name) {
      rejections.invalidName += 1;
      continue;
    }
    const credentialType = cleanText(item.credentialtype);
    const credentialName = cleanText(item.credential);
    const status = cleanText(item.status);
    if (!credentialType || !credentialName || !status) {
      rejections.missingCredential += 1;
      continue;
    }

    const street = cleanText(item.address);
    const city = cleanText(item.city);
    const state = cleanText(item.state)?.toUpperCase();
    const zip = cleanText(item.zip);
    const address = street || city || state || zip ? { street, city, state, zip } : undefined;
    rows.push({
      source: SOURCE_NAME,
      sourceRecordId,
      ...name,
      address,
      credential: {
        type: credentialType,
        name: credentialName,
        number: cleanText(item.credentialnumber),
        fullCode: cleanText(item.fullcredentialcode),
        status,
        issueDate: parseDate(item.issuedate, rejections),
        expirationDate: parseDate(item.expirationdate, rejections),
        refreshedDate: parseDate(item.recordrefreshedon, rejections),
      },
    });
  }

  if (payload.length > 0 && !advancedCursor) {
    throw new Error("Connecticut licenses page has no usable credentialid cursor");
  }

  return {
    rows,
    sourceRowCount: payload.length,
    nextCursor: advancedCursor ? lastId.toString() : undefined,
    done: payload.length < pageSize,
    rejections,
  };
}

function verifyMetadata(payload: unknown): BulkSourceMetadata {
  if (!payload || typeof payload !== "object") throw new Error("Connecticut licenses metadata is invalid");
  const metadata = payload as SocrataMetadata;
  if (metadata.id !== CONNECTICUT_LICENSES_DATASET_ID) {
    throw new Error("Connecticut licenses metadata returned the wrong dataset ID");
  }
  if (metadata.licenseId !== "PUBLIC_DOMAIN") {
    throw new Error(`Connecticut licenses requires PUBLIC_DOMAIN metadata, received ${String(metadata.licenseId)}`);
  }
  if (typeof metadata.name !== "string" || !Array.isArray(metadata.columns)) {
    throw new Error("Connecticut licenses metadata is missing its name or columns");
  }
  const columns = metadata.columns as SocrataColumn[];
  const fields = new Map(columns.map((column) => [column.fieldName, column.dataTypeName]));
  const missing = [...REQUIRED_COLUMNS].filter((field) => !fields.has(field));
  if (missing.length > 0) throw new Error(`Connecticut licenses metadata is missing columns: ${missing.join(", ")}`);
  if (fields.get("credentialid") !== "number") {
    throw new Error("Connecticut licenses credentialid is no longer numeric");
  }
  const updatedSeconds = typeof metadata.rowsUpdatedAt === "number" ? metadata.rowsUpdatedAt : undefined;
  return {
    source: SOURCE_NAME,
    datasetId: CONNECTICUT_LICENSES_DATASET_ID,
    datasetName: metadata.name,
    licenseId: "PUBLIC_DOMAIN",
    officialMetadataUrl: CONNECTICUT_LICENSES_METADATA_URL,
    officialDataUrl: CONNECTICUT_LICENSES_DATA_URL,
    rowsUpdatedAt: updatedSeconds === undefined ? undefined : new Date(updatedSeconds * 1_000).toISOString(),
  };
}

export class ConnecticutStateLicensesBulkSource implements BulkSource {
  readonly sourceName = SOURCE_NAME;
  private readonly pageSize: number;
  private readonly maxPageBytes: number;
  private readonly appToken?: string;
  private readonly request: FetchLike;
  private metadataPromise?: Promise<BulkSourceMetadata>;

  constructor(options: ConnecticutStateLicensesOptions = {}) {
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxPageBytes = options.maxPageBytes ?? DEFAULT_PAGE_BYTES;
    if (!Number.isInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > MAX_PAGE_SIZE) {
      throw new RangeError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    if (!Number.isInteger(this.maxPageBytes) || this.maxPageBytes < 1 || this.maxPageBytes > MAX_PAGE_BYTES) {
      throw new RangeError(`maxPageBytes must be an integer between 1 and ${MAX_PAGE_BYTES}`);
    }
    this.appToken = options.appToken ?? process.env.CONNECTICUT_SOCRATA_APP_TOKEN;
    this.request = options.fetch ?? fetchWithRetry;
  }

  fetchMetadata(): Promise<BulkSourceMetadata> {
    this.metadataPromise ??= this.loadMetadata();
    return this.metadataPromise;
  }

  private async loadMetadata(): Promise<BulkSourceMetadata> {
    const response = await this.request(CONNECTICUT_LICENSES_METADATA_URL, { headers: this.headers() });
    if (!response.ok) throw new Error(`Connecticut licenses metadata request failed: ${response.status}`);
    const text = await readBoundedText(response, MAX_METADATA_BYTES, "Connecticut licenses metadata");
    return verifyMetadata(JSON.parse(text) as unknown);
  }

  async fetchPage(cursor?: string): Promise<BulkPage> {
    await this.fetchMetadata();
    const normalizedCursor = cursor === undefined ? undefined : parseCredentialId(cursor);
    if (cursor !== undefined && !normalizedCursor) throw new TypeError("cursor must be a positive numeric credential ID");
    const url = buildConnecticutLicensesPageUrl(normalizedCursor, this.pageSize);
    const response = await this.request(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`Connecticut licenses page request failed: ${response.status}`);
    const text = await readBoundedText(response, this.maxPageBytes, "Connecticut licenses page");
    return parseConnecticutLicensesPage(JSON.parse(text) as unknown, this.pageSize, normalizedCursor);
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": "UnnamedFiles/1.0 (contact@unnamedfiles.com)",
      ...(this.appToken ? { "X-App-Token": this.appToken } : {}),
    };
  }
}
