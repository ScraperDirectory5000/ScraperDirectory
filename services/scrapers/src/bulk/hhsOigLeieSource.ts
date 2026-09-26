import {
  HHS_OIG_LEIE_SOURCE,
  HhsOigLeieBulkAdapter,
  type HhsOigLeieSnapshot,
} from "./hhsOigLeie.js";
import type { BulkPage, BulkSource, BulkSourceMetadata } from "./types.js";

export class HhsOigLeieBulkSource implements BulkSource {
  readonly sourceName = HHS_OIG_LEIE_SOURCE;
  private snapshot?: Promise<HhsOigLeieSnapshot>;

  constructor(private readonly adapter = new HhsOigLeieBulkAdapter()) {}

  private download(): Promise<HhsOigLeieSnapshot> {
    this.snapshot ??= this.adapter.download();
    return this.snapshot;
  }

  async fetchMetadata(): Promise<BulkSourceMetadata> {
    const { metadata } = await this.download();
    return {
      source: metadata.source,
      datasetId: "hhs-oig-leie",
      datasetName: metadata.datasetName,
      licenseId: "US_GOVERNMENT_PUBLIC_RECORD",
      officialMetadataUrl: metadata.officialMetadataUrl,
      officialDataUrl: metadata.verificationUrl,
      rowsUpdatedAt: metadata.lastUpdated,
    };
  }

  async fetchPage(cursor?: string): Promise<BulkPage> {
    if (cursor !== undefined) throw new Error("HHS OIG LEIE is published as one bounded snapshot");
    const snapshot = await this.download();
    const businessRows = snapshot.rows.filter((row) => row.entityKind === "BUSINESS").length;
    return {
      rows: snapshot.rows.flatMap((row) => {
        if (row.entityKind !== "INDIVIDUAL" || !row.firstName || !row.lastName) return [];
        return [{
          source: row.source,
          personExternalId: row.stableIdentity.key,
          sourceRecordId: row.sourceRecordId,
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          dobYear: row.dobYear,
          address: row.address,
          publicRecord: {
            type: "federal_exclusion",
            title: row.specialty ?? row.providerType ?? "HHS OIG exclusion",
            number: row.npi ?? row.upin,
            status: row.reinstatementDate ? "Reinstated; identity unverified" : "Excluded; identity unverified",
            startDate: row.exclusionDate,
            endDate: row.reinstatementDate,
            description: snapshot.metadata.sourceWarning,
          },
        }];
      }),
      sourceRowCount: snapshot.sourceRowCount,
      done: true,
      rejections: { ...snapshot.rejections, businessEntity: businessRows },
    };
  }
}