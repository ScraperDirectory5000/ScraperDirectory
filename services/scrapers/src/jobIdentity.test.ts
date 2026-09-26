import assert from "node:assert/strict";
import test from "node:test";
import { searchJobId } from "./jobIdentity.js";

test("keeps search job IDs stable for the same query and providers", () => {
  const query = { firstName: "Jane", lastName: "Doe", state: "CA" };
  assert.equal(searchJobId(query, ["npi_registry"]), searchJobId(query, ["npi_registry"]));
});

test("changes search job IDs when the provider set changes", () => {
  const query = { firstName: "Jane", lastName: "Doe", state: "CA" };
  assert.notEqual(
    searchJobId(query, ["npi_registry"]),
    searchJobId(query, ["npi_registry", "california_corrections"])
  );
});