import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedText } from "./boundedResponse.js";

test("reads a response within the byte limit", async () => {
  const response = new Response("Nevada data", {
    headers: { "Content-Length": "12" },
  });

  assert.equal(await readBoundedText(response, 12, "NDOC"), "Nevada data");
});

test("rejects a declared response larger than the byte limit", async () => {
  const response = new Response("oversized", {
    headers: { "Content-Length": "100" },
  });

  await assert.rejects(readBoundedText(response, 10, "NDOC"), /exceeds 10 byte limit/);
});

test("rejects a streamed response that crosses the byte limit", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345"));
      controller.enqueue(new TextEncoder().encode("67890"));
      controller.close();
    },
  }));

  await assert.rejects(readBoundedText(response, 8, "NDOC"), /exceeds 8 byte limit/);
});