import assert from "node:assert/strict";
import test from "node:test";
import { classifyNewsMention, newsIdentity } from "./newsRecords.js";

test("classifies life-event and crime topics as unverified news mentions", () => {
  assert.equal(classifyNewsMention("Funeral services will be held Friday"), "obituary_mention");
  assert.equal(classifyNewsMention("The couple announced the birth of a daughter"), "birth_announcement");
  assert.equal(classifyNewsMention("Police arrested a suspect"), "crime_news_mention");
  assert.equal(classifyNewsMention("Named to the local board"), "newspaper_mention");
});

test("requires topic terms to appear near the searched name", () => {
  assert.equal(
    classifyNewsMention(`Police made an arrest.${" unrelated".repeat(50)} Amelia Earhart spoke.`, "Amelia Earhart"),
    "newspaper_mention"
  );
  assert.equal(
    classifyNewsMention("Police arrested Amelia Earhart after the hearing.", "Amelia Earhart"),
    "crime_news_mention"
  );
});

test("builds a stable state-scoped news identity", () => {
  assert.equal(newsIdentity({ firstName: "Jane", lastName: "Doe", state: "CA" }), "jane|doe|ca");
  assert.equal(newsIdentity({ firstName: "Jane", lastName: "Doe" }), "jane|doe|all");
});