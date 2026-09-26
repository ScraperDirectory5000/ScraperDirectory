import { ConnecticutStateLicensesBulkSource } from "./connecticutStateLicenses.js";
import { HhsOigLeieBulkSource } from "./hhsOigLeieSource.js";
import type { BulkSource } from "./types.js";

export function createBulkSource(name: string): BulkSource {
  if (name === "connecticut_state_licenses") return new ConnecticutStateLicensesBulkSource();
  if (name === "hhs_oig_leie") return new HhsOigLeieBulkSource();
  throw new Error(`Unknown bulk source: ${name}`);
}