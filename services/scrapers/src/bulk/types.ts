export interface BulkPostalAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface BulkCredential {
  type: string;
  name: string;
  number?: string;
  fullCode?: string;
  status: string;
  issueDate?: string;
  expirationDate?: string;
  refreshedDate?: string;
}

export interface BulkPublicRecord {
  type: string;
  title: string;
  number?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface BulkPersonRow {
  source: string;
  sourceRecordId: string;
  personExternalId?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  dobYear?: number;
  address?: BulkPostalAddress;
  credential?: BulkCredential;
  publicRecord?: BulkPublicRecord;
}

export interface BulkRejectionCounters {
  [key: string]: number;
  nonIndividual: number;
  missingCredentialId: number;
  invalidCredentialId: number;
  invalidName: number;
  missingCredential: number;
  invalidDate: number;
}

export interface BulkPage {
  rows: BulkPersonRow[];
  sourceRowCount: number;
  nextCursor?: string;
  done: boolean;
  rejections: Record<string, number>;
}

export interface BulkSourceMetadata {
  source: string;
  datasetId: string;
  datasetName: string;
  licenseId: string;
  officialMetadataUrl: string;
  officialDataUrl: string;
  rowsUpdatedAt?: string;
}

export interface BulkSource {
  readonly sourceName: string;
  fetchMetadata(): Promise<BulkSourceMetadata>;
  fetchPage(cursor?: string): Promise<BulkPage>;
}
