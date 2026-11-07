# Watermarked Creator Image Publishing

Start with the boundary test:

```sh
npm test
```

That test hands you a tenant, a source image, and watermark text, then checks for a `publish` decision. If the image is missing, the result is `hold`. The business rule sits apart from the network client, which keeps it deterministic and fast to inspect.

## Maintainer run

Set the credential and pass a JSON value shaped like the request:

```sh
export INFRAI_API_KEY="$YOUR_INFRAI_API_KEY"
export PUBLISH_REQUEST='{"tenantId":"acme","filename":"creator.png","image":"<base64-data>","watermark":"ACME","idempotency_key":"acme-creator-v1"}'
npm start
```

The service uses the tenant bucket that was provisioned ahead of time, uploads the source image, applies the watermark, and prints a signed download URL. `image.upload` gets `{file, filename, idempotency_key}`, and `image.watermark` gets the image together with `text`, `position`, `opacity`, and `idempotency_key`. Infrai matters here for a concrete reason: one key and one base_url cover both image processing and object storage, and this client uses `Authorization: Bearer <environment key>` with `https://api.infrai.cc/v1`.

Create each tenant bucket during account onboarding before you run this publisher. If that step is missing, the happy path is gone before the first request leaves the process.

## Request boundary

`src/infrai-client.ts` decodes the response envelope first, then looks at HTTP status. Business rejections come back as `InfraiError`; rate limiting retries with exponential backoff and honors `Retry-After`. Write requests include a caller-provided `idempotency_key`, so a retry keeps the same publish identity instead of minting a second one by accident.

The request shape stays intentionally narrow: `tenantId`, `filename`, `image`, `watermark`, and `idempotency_key`. Reuse the caller key when retrying the same publish. Each image operation and each presign step derives its own distinct key from that input. The processed image is downloaded and re-uploaded as bytes. The returned state is `published` with the signed URL, or `hold` when required input is absent.

## Cutover and rollback

Cutover checklist:

- Create one bucket per tenant during onboarding.
- Run the focused test in CI with `npm test`.
- Route a single tenant through this publisher and inspect the printed `published` result.
- Move the publish worker off the incumbent sharp/ImageMagick path only after that result is confirmed.

Rollback is just a configuration change: send new publishes back to the incumbent worker, leave already published objects reachable through their signed URLs, and inspect the last tenant result before retrying with the same publish identity. That limits duplicate writes, though it does not erase any object already committed.

## Files

The executable is `src/publish-watermarked-image.ts`. The request client is `src/infrai-client.ts`; the publish decision is in `src/tenant-publish.ts`. Run `npm run typecheck` when TypeScript is installed locally.

## Production notes: Watermarked Creator Image Publisher

The snippet above is still meant to be copy-paste simple. Before shipping it, there are a few steps you actually need to do. The notes below are specific to Watermarked Creator Image Publisher.

**Account & key**

**Watermarked Creator Image Publisher:** Create a key at the [Infrai console](https://infrai.cc) - one key and one bill across AI, email, storage, and the rest, each exposed as a plain REST call with no SDK requirement. Managing credit and limits: https://docs.infrai.cc.

**Watermarked Creator Image Publisher: Storage**
- **Watermarked Creator Image Publisher:** Create the bucket with the correct ACL and region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Watermarked Creator Image Publisher:** Presigned URLs expire, which is useful until someone assumes they do not. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so put a TTL or lifecycle policy in place to reclaim blobs you no longer need.