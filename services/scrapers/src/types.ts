/** A single normalized fact set produced by a connector for one matched person.
 * Connectors never write to the DB directly — they return this shape and
 * `normalize.ts` / `db.ts` handle merge/dedup and persistence. */
export interface NormalizedPerson {
  externalId?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dobYear?: number;
  addresses?: NormalizedAddress[];
  phones?: NormalizedPhone[];
  emails?: NormalizedEmail[];
  lifeEvents?: NormalizedLifeEvent[];
  relationshipClaims?: NormalizedRelationshipClaim[];
  /** Maps to the `court_records` table, which is used generically for any
   * case/filing-shaped record (court cases, business filings, etc.) via caseType. */
  records?: NormalizedCourtRecord[];
  source: string; // matches record_sources.name
}

export interface NormalizedAddress {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface NormalizedPhone {
  number: string;
  phoneType?: "mobile" | "landline" | "voip";
}

export interface NormalizedEmail {
  email: string;
}

export interface NormalizedLifeEvent {
  sourceRecordId: string;
  eventType: "obituary" | "death" | "marriage" | "birth";
  eventDate?: string;
  state?: string;
  locality?: string;
  description?: string;
  sourceUrl: string;
  confidence: number;
}

export interface NormalizedRelationshipClaim {
  sourceRecordId: string;
  relationType: "spouse" | "parent" | "adult_child" | "sibling";
  relatedFirstName: string;
  relatedMiddleName?: string;
  relatedLastName: string;
  relatedIsAdult: true;
  eventDate?: string;
  sourceUrl: string;
  confidence: number;
}

export interface NormalizedCourtRecord {
  caseNumber?: string;
  courtName?: string;
  state?: string;
  caseType?: string;
  filingDate?: string; // ISO date
  disposition?: string;
  sourceUrl?: string;
}

export interface PersonQuery {
  firstName: string;
  lastName: string;
  state?: string;
}

/** Every scraper/connector implements this. Keep connectors limited to sources
 * that are genuinely public and don't require bypassing auth or bot-detection. */
export interface Connector {
  sourceName: string;
  search(query: PersonQuery): Promise<NormalizedPerson[]>;
}
