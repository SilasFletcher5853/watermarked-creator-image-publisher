import assert from "node:assert/strict";
import { publishDecision } from "./tenant-publish.ts";

assert.equal(publishDecision({ tenantId: "acme", filename: "creator.png", image: "data", watermark: "ACME", idempotency_key: "test-publish" }), "publish");
assert.equal(publishDecision({ tenantId: "acme", filename: "creator.png", image: "", watermark: "ACME", idempotency_key: "test-publish" }), "hold");
console.log("publish decision test passed");

const { publishImage } = await import("./publish-watermarked-image.ts");
const { InfraiClient } = await import("./infrai-client.ts");
const originalFetch = globalThis.fetch;
const keys: string[] = [];
const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
let transferred = false;
globalThis.fetch = async (url, options) => {
  const path = String(url);
  if (path === "https://images.test/processed") return new Response(bytes);
  if (path === "https://storage.test/put") {
    assert.ok(options?.body instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(options.body), bytes);
    transferred = true;
    return new Response(null, { status: 200 });
  }
  const body = JSON.parse(String(options?.body));
  keys.push(body.idempotency_key);
  const data = path.endsWith("/image/upload") ? { image_id: "source" }
    : path.endsWith("/image/watermark") ? { url: "https://images.test/processed" }
    : { url: `https://storage.test/${body.op}` };
  return Response.json({ ok: true, data });
};
try {
  const input = { tenantId: "acme", filename: "creator.png", image: "data", watermark: "ACME", idempotency_key: "publish-v1" };
  const client = new InfraiClient("test");
  assert.deepEqual(await publishImage(input, client), { state: "published", downloadUrl: "https://storage.test/get" });
  assert.ok(transferred);
  assert.equal(new Set(keys).size, 4);
  assert.ok(keys.every(key => key.startsWith("publish-v1:")));
  const firstKeys = [...keys];
  await publishImage(input, client);
  assert.deepEqual(keys.slice(4), firstKeys);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("publish bytes and idempotency test passed");
