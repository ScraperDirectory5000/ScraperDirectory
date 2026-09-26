import { createHash } from "node:crypto";
import { fetchWithRetry } from "../connectors/fetchWithRetry.js";

export const HHS_OIG_LEIE_SOURCE = "hhs_oig_leie";
export const HHS_OIG_LEIE_DATA_URL =
  "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";
export const HHS_OIG_LEIE_METADATA_URL =
  "https://oig.hhs.gov/exclusions/leie-database-supplement-downloads/";
export const HHS_OIG_LEIE_VERIFICATION_URL = "https://exclusions.oig.hhs.gov/";
export const HHS_OIG_LEIE_SOURCE_WARNING =
  "The Privacy Act prohibits the distribution of SSNs so regardless of your exact process, you'll need to use the Online Search to verify specific individuals and entities.";

const MAX_CSV_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const EXPECTED_HEADERS = [
  "LASTNAME",
  "FIRSTNAME",
  "MIDNAME",
  "BUSNAME",
  "GENERAL",
  "SPECIALTY",
  "UPIN",
  "NPI",
  "DOB",
  "ADDRESS",
  "CITY",
  "STATE",
  "ZIP",
  "EXCLTYPE",
  "EXCLDATE",
  "REINDATE",
  "WAIVERDATE",
  "WVRSTATE",
] as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type LeieHeader = (typeof EXPECTED_HEADERS)[number];

export interface HhsOigLeieMetadata {
  source: typeof HHS_OIG_LEIE_SOURCE;
  datasetName: "List of Excluded Individuals/Entities";
  officialMetadataUrl: typeof HHS_OIG_LEIE_METADATA_URL;
  officialDataUrl: typeof HHS_OIG_LEIE_DATA_URL;
  lastUpdated: string;
  releaseMonth: string;
  sourceWarning: typeof HHS_OIG_LEIE_SOURCE_WARNING;
  verificationUrl: typeof HHS_OIG_LEIE_VERIFICATION_URL;
}

export interface HhsOigLeieIdentity {
  strategy: "NPI" | "UPIN" | "NAME_DOB_EXCLUSION";
  key: string;
  verificationStatus: "UNVERIFIED";
}

export interface HhsOigLeieRow {
  source: typeof HHS_OIG_LEIE_SOURCE;
  sourceRecordId: string;
  entityKind: "INDIVIDUAL" | "BUSINESS";
  firstName?: string;
  middleName?: string;
  lastName?: string;
  businessName?: string;
  dobYear?: number;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  providerType?: string;
  specialty?: string;
  npi?: string;
  upin?: string;
  exclusionType: string;
  exclusionDate: string;
  reinstatementDate?: string;
  waiverDate?: string;
  waiverState?: string;
  stableIdentity: HhsOigLeieIdentity;
  provenance: {
    officialDataUrl: typeof HHS_OIG_LEIE_DATA_URL;
    officialMetadataUrl: typeof HHS_OIG_LEIE_METADATA_URL;
    sourceWarning: typeof HHS_OIG_LEIE_SOURCE_WARNING;
  };
}

export interface HhsOigLeieRejections {
  missingName: number;
  missingExclusion: number;
  invalidDate: number;
  invalidNpi: number;
  invalidUpin: number;
}

export interface HhsOigLeieSnapshot {
  metadata: HhsOigLeieMetadata;
  rows: HhsOigLeieRow[];
  sourceRowCount: number;
  rejections: HhsOigLeieRejections;
}

export interface HhsOigLeieOptions {
  maxCsvBytes?: number;
  fetch?: FetchLike;
}

function cleanText(value: string): string | undefined {
  const cleaned = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function canonicalIdentityPart(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseCompactDate(value: string): string | undefined | null {
  const text = cleanText(value);
  if (!text || text === "00000000") return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function parseDobYear(value: string): number | undefined | null {
  const text = cleanText(value);
  if (!text || text === "00000000") return undefined;
  const date = parseCompactDate(text);
  if (date === null || date === undefined) return null;
  return Number(date.slice(0, 4));
}

function validNpi(value: string): boolean {
  if (!/^\d{10}$/.test(value) || value === "0000000000") return false;
  const digits = `80840${value.slice(0, 9)}`.split("").map(Number);
  let sum = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits[index];
    if ((digits.length - index) % 2 === 1) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

function parseNpi(value: string): string | undefined | null {
  const text = cleanText(value);
  if (!text || text === "0000000000") return undefined;
  return validNpi(text) ? text : null;
}

function parseUpin(value: string): string | undefined | null {
  const text = cleanText(value)?.toUpperCase();
  if (!text || text === "000000") return undefined;
  return /^[A-Z0-9]{6}$/.test(text) ? text : null;
}

function nonEmptyAddress(parts: HhsOigLeieRow["address"]): HhsOigLeieRow["address"] {
  return parts && Object.values(parts).some(Boolean) ? parts : undefined;
}

function makeStableIdentity(
  npi: string | undefined,
  upin: string | undefined,
  identityParts: readonly string[],
): HhsOigLeieIdentity {
  if (npi) return { strategy: "NPI", key: `npi:${npi}`, verificationStatus: "UNVERIFIED" };
  if (upin) return { strategy: "UPIN", key: `upin:${upin}`, verificationStatus: "UNVERIFIED" };
  return {
    strategy: "NAME_DOB_EXCLUSION",
    key: `name-dob-exclusion:sha256:${sha256(identityParts.join("|"))}`,
    verificationStatus: "UNVERIFIED",
  };
}

export function parseRfc4180Csv(input: string): string[][] {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    record.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error(`Invalid CSV character after closing quote at offset ${index}`);
    }
    if (character === '"') {
      if (field.length > 0 || closedQuote) throw new Error(`Invalid CSV quote at offset ${index}`);
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") throw new Error(`Invalid bare carriage return at offset ${index}`);
      finishRecord();
      index += 1;
    } else if (character === "\n") {
      finishRecord();
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || record.length > 0 || closedQuote) finishRecord();
  return records;
}

function emptyRejections(): HhsOigLeieRejections {
  return { missingName: 0, missingExclusion: 0, invalidDate: 0, invalidNpi: 0, invalidUpin: 0 };
}

export function parseHhsOigLeieCsv(csv: string): Omit<HhsOigLeieSnapshot, "metadata"> {
  const records = parseRfc4180Csv(csv);
  if (records.length === 0) throw new Error("HHS OIG LEIE CSV is empty");
  if (
    records[0].length !== EXPECTED_HEADERS.length ||
    records[0].some((header, index) => header !== EXPECTED_HEADERS[index])
  ) {
    throw new Error(`HHS OIG LEIE CSV header mismatch: ${records[0].join(",")}`);
  }

  const rows: HhsOigLeieRow[] = [];
  const rejections = emptyRejections();
  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    if (record.length === 1 && record[0] === "") continue;
    if (record.length !== EXPECTED_HEADERS.length) {
      throw new Error(`HHS OIG LEIE row ${recordIndex + 1} has ${record.length} columns; expected ${EXPECTED_HEADERS.length}`);
    }
    const source = Object.fromEntries(EXPECTED_HEADERS.map((header, index) => [header, record[index]])) as Record<LeieHeader, string>;
    const firstName = cleanText(source.FIRSTNAME);
    const middleName = cleanText(source.MIDNAME);
    const lastName = cleanText(source.LASTNAME);
    const businessName = cleanText(source.BUSNAME);
    if ((!firstName || !lastName) && !businessName) {
      rejections.missingName += 1;
      continue;
    }

    const exclusionType = cleanText(source.EXCLTYPE);
    const exclusionDate = parseCompactDate(source.EXCLDATE);
    if (!exclusionType || exclusionDate === undefined) {
      rejections.missingExclusion += 1;
      continue;
    }
    if (exclusionDate === null) {
      rejections.invalidDate += 1;
      continue;
    }
    const reinstatementDate = parseCompactDate(source.REINDATE);
    const waiverDate = parseCompactDate(source.WAIVERDATE);
    const dobYear = parseDobYear(source.DOB);
    if (reinstatementDate === null || waiverDate === null || dobYear === null) {
      rejections.invalidDate += 1;
      continue;
    }

    const parsedNpi = parseNpi(source.NPI);
    const parsedUpin = parseUpin(source.UPIN);
    if (parsedNpi === null) rejections.invalidNpi += 1;
    if (parsedUpin === null) rejections.invalidUpin += 1;
    const npi = parsedNpi ?? undefined;
    const upin = parsedUpin ?? undefined;
    const canonicalParts = [
      canonicalIdentityPart(businessName ?? lastName),
      canonicalIdentityPart(businessName ? undefined : firstName),
      canonicalIdentityPart(businessName ? undefined : middleName),
      dobYear === undefined ? "" : String(dobYear),
      canonicalIdentityPart(exclusionType),
      exclusionDate,
    ];
    const stableIdentity = makeStableIdentity(npi, upin, canonicalParts);
    const rowFingerprint = sha256([
      stableIdentity.key,
      ...record.map((value) => canonicalIdentityPart(value)),
    ].join("|"));

    rows.push({
      source: HHS_OIG_LEIE_SOURCE,
      sourceRecordId: `leie:sha256:${rowFingerprint}`,
      entityKind: businessName ? "BUSINESS" : "INDIVIDUAL",
      firstName,
      middleName,
      lastName,
      businessName,
      dobYear,
      address: nonEmptyAddress({
        street: cleanText(source.ADDRESS),
        city: cleanText(source.CITY),
        state: cleanText(source.STATE)?.toUpperCase(),
        zip: cleanText(source.ZIP),
      }),
      providerType: cleanText(source.GENERAL),
      specialty: cleanText(source.SPECIALTY),
      npi,
      upin,
      exclusionType,
      exclusionDate,
      reinstatementDate: reinstatementDate ?? undefined,
      waiverDate: waiverDate ?? undefined,
      waiverState: cleanText(source.WVRSTATE)?.toUpperCase(),
      stableIdentity,
      provenance: {
        officialDataUrl: HHS_OIG_LEIE_DATA_URL,
        officialMetadataUrl: HHS_OIG_LEIE_METADATA_URL,
        sourceWarning: HHS_OIG_LEIE_SOURCE_WARNING,
      },
    });
  }

  return { rows, sourceRowCount: records.length - 1, rejections };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseUsDate(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) throw new Error(`Invalid HHS OIG LEIE metadata date: ${value}`);
  const [, month, day, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid HHS OIG LEIE metadata date: ${value}`);
  }
  return `${year}-${month}-${day}`;
}

export function parseHhsOigLeieMetadata(html: string): HhsOigLeieMetadata {
  const text = htmlToText(html);
  const updatedMatch = /(\d{2}-\d{2}-\d{4})\s+Last Update\b/i.exec(text);
  const releaseMatch = /\b(\d{2})-(\d{4})\s+Updated LEIE Database\b/i.exec(text);
  if (!updatedMatch || !releaseMatch) throw new Error("HHS OIG LEIE landing page metadata was not recognized");
  if (!text.includes("The Privacy Act prohibits the distribution of SSNs")) {
    throw new Error("HHS OIG LEIE landing page no longer contains the identity verification warning");
  }
  return {
    source: HHS_OIG_LEIE_SOURCE,
    datasetName: "List of Excluded Individuals/Entities",
    officialMetadataUrl: HHS_OIG_LEIE_METADATA_URL,
    officialDataUrl: HHS_OIG_LEIE_DATA_URL,
    lastUpdated: parseUsDate(updatedMatch[1]),
    releaseMonth: `${releaseMatch[2]}-${releaseMatch[1]}`,
    sourceWarning: HHS_OIG_LEIE_SOURCE_WARNING,
    verificationUrl: HHS_OIG_LEIE_VERIFICATION_URL,
  };
}

async function readBoundedUtf8(response: Response, maxBytes: number, label: string): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      await response.body?.cancel();
      throw new Error(`${label} returned an invalid Content-Length`);
    }
    if (declaredBytes > maxBytes) {
      await response.body?.cancel();
      throw new Error(`${label} response exceeds ${maxBytes} byte limit`);
    }
  }
  if (!response.body) throw new Error(`${label} response body is missing`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) throw new Error(`${label} response exceeds ${maxBytes} byte limit`);
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

export class HhsOigLeieBulkAdapter {
  readonly sourceName = HHS_OIG_LEIE_SOURCE;
  private readonly maxCsvBytes: number;
  private readonly fetch: FetchLike;

  constructor(options: HhsOigLeieOptions = {}) {
    this.maxCsvBytes = options.maxCsvBytes ?? MAX_CSV_BYTES;
    if (!Number.isSafeInteger(this.maxCsvBytes) || this.maxCsvBytes < 1 || this.maxCsvBytes > MAX_CSV_BYTES) {
      throw new RangeError(`maxCsvBytes must be an integer between 1 and ${MAX_CSV_BYTES}`);
    }
    this.fetch = options.fetch ?? fetchWithRetry;
  }

  async fetchMetadata(): Promise<HhsOigLeieMetadata> {
    const response = await this.fetch(HHS_OIG_LEIE_METADATA_URL, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) throw new Error(`HHS OIG LEIE metadata request failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) throw new Error(`HHS OIG LEIE metadata returned ${contentType || "no Content-Type"}`);
    return parseHhsOigLeieMetadata(await readBoundedUtf8(response, MAX_METADATA_BYTES, "HHS OIG LEIE metadata"));
  }

  async download(): Promise<HhsOigLeieSnapshot> {
    const metadata = await this.fetchMetadata();
    const response = await this.fetch(HHS_OIG_LEIE_DATA_URL, {
      headers: { Accept: "text/csv" },
    });
    if (!response.ok) throw new Error(`HHS OIG LEIE download failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/csv") && !contentType.includes("application/csv")) {
      throw new Error(`HHS OIG LEIE download returned ${contentType || "no Content-Type"}`);
    }
    const csv = await readBoundedUtf8(response, this.maxCsvBytes, "HHS OIG LEIE CSV");
    return { metadata, ...parseHhsOigLeieCsv(csv) };
  }
}