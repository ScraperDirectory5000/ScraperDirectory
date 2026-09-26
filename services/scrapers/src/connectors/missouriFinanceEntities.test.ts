import assert from "node:assert/strict";
import test from "node:test";
import {
  MISSOURI_FINANCE_ENTITIES_DATASET_URL,
  MissouriFinanceEntitiesConnector,
  normalizeMissouriFinanceEntities,
} from "./missouriFinanceEntities.js";

const rows = [
  {
    description: "Mortgage Loan Originator",
    name: "  Abbott,   William Jacob  ",
    address: "19045 E Valley View Parkway, Suite F",
    city: "Independence",
    state: "MO",
    zipcode: "6405",
    license: "12262-MLO",
    approval: "1448724",
    type: "MLO",
    county: "Jackson",
  },
  {
    description: "Mortgage Loan Originator",
    name: "ABBOTT, WILLIAM JACOB",
    address: "1000 W. Nifong Suite 140",
    city: "Columbia",
    state: "MO",
    zipcode: "6520",
    license: "12262-MLO",
    approval: "1448724",
    type: "MLO",
  },
  {
    description: "Mortgage Loan Originator",
    name: "Abbott, Williamson James",
    license: "99999-MLO",
    approval: "9999999",
    type: "MLO",
  },
  {
    description: "Mortgage Broker",
    name: "Abbott, William Jacob",
    license: "MB-123",
    approval: "123",
    type: "MB",
  },
  {
    description: "Mortgage Loan Originator",
    name: "Abbott, William Jacob",
    approval: "456",
    type: "MLO",
  },
];

test("normalizes an exact Missouri MLO name and deduplicates approval-level rows", () => {
  const people = normalizeMissouriFinanceEntities(rows, {
    firstName: "william",
    lastName: "abbott",
    state: "MO",
  });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "1448724");
  assert.equal(people[0].firstName, "William");
  assert.equal(people[0].middleName, "Jacob");
  assert.equal(people[0].lastName, "Abbott");
  assert.equal(people[0].addresses?.length, 2);
  assert.equal(people[0].records?.[0].caseNumber, "12262-MLO");
  assert.equal(people[0].records?.[0].state, "MO");
  assert.equal(people[0].records?.[0].caseType, "professional_license");
  assert.equal(
    people[0].records?.[0].disposition,
    "Status: Not provided by source | Type: Mortgage Loan Originator (MLO) | Location: Independence, MO (Jackson County) | Approval ID: 1448724"
  );
  assert.equal(people[0].records?.[0].sourceUrl, MISSOURI_FINANCE_ENTITIES_DATASET_URL);
});

test("rejects partial names, entity rows, and MLO rows without a license number", () => {
  assert.deepEqual(normalizeMissouriFinanceEntities(rows, {
    firstName: "Will",
    lastName: "Abbott",
    state: "MO",
  }), []);
  assert.deepEqual(normalizeMissouriFinanceEntities(rows.slice(2), {
    firstName: "William",
    lastName: "Abbott",
    state: "MO",
  }), []);
});

test("is state-only for Missouri queries", async () => {
  const people = await new MissouriFinanceEntitiesConnector().search({
    firstName: "William",
    lastName: "Abbott",
    state: "KS",
  });
  assert.deepEqual(people, []);
});

test("live Missouri Finance Entities API returns an exact person with stable identifiers", {
  skip: process.env.LIVE_CONNECTOR_TESTS !== "true",
}, async () => {
  const people = await new MissouriFinanceEntitiesConnector().search({
    firstName: "William",
    lastName: "Abbott",
    state: "MO",
  });

  assert.equal(people.length, 1);
  assert.equal(people[0].externalId, "1448724");
  assert.equal(people[0].records?.[0].caseNumber, "12262-MLO");
  assert.equal(people[0].records?.[0].state, "MO");
  assert.match(people[0].records?.[0].disposition ?? "", /Status: Not provided by source \| Type: Mortgage Loan Originator \(MLO\) \| Location: /);
  assert.equal(people[0].records?.[0].sourceUrl, MISSOURI_FINANCE_ENTITIES_DATASET_URL);
  assert.ok((people[0].addresses?.length ?? 0) > 0);
});