import { createHash } from "node:crypto";
import type { PersonQuery } from "./types.js";

export function searchJobId(query: PersonQuery, connectorNames: string[]): string {
  const key = [
    query.firstName.toLowerCase(),
    query.lastName.toLowerCase(),
    query.state ?? "",
    ...connectorNames,
  ].join("|");
  return `search-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}