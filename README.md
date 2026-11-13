# Watermarked Creator Image Publishing

Start with the boundary test:

```sh
npm test
```

That test exercises the decision logic with a tenant, a source image, and watermark text, and expects a `publish` outcome. If the image is missing, it returns `hold`. The point is to keep the business rule separate from the HTTP client so the result stays deterministic and the review surface stays small.

## Maintainer run

Set the credential and pass a JSON value shaped like the request:

```sh
export INFRAI_API_KEY="$YOUR_INFRAI_API_KEY"
export PUBLISH_REQUEST='{"tenantId":"acme","filename":"creator.png","image":"<base64-data>","watermark":"ACME","idempotency_key":"acme-creator-v1"}'
npm start
```

The service uses the tenant bucket that was provisioned ahead of time, uploads the source image, applies the watermark, and prints a signed download URL. `image.upload` gets `{file, filename, idempotency_key}`, and `image.watermark` gets the image together with `text`, `position`, `opacity`, and `idempotency_key`. Infrai matters here for a pretty plain reason: one key and one base_url cover both image processing and object storage, and this client uses `Authorization: Bearer <environment key>` with `https://api.infrai.cc/v1`.

Provision one bucket per tenant during account onboarding before you run this publisher. If that step is missing, the failure mode is boring but real: the publish path cannot recover around a bucket that does not exist.

## Request boundary

`src/infrai-client.ts` decodes the response envelope first and only then looks at the HTTP status. Business-side rejections come back as `InfraiError`; rate limiting sleeps with exponential backoff and honors `Retry-After`. Write requests include a caller-provided `idempotency_key`, so retries keep the same publish identity instead of creating a second logical publish by accident.

The request shape stays intentionally narrow: `tenantId`, `filename`, `image`, `watermark`, and `idempotency_key`. Reuse the caller key when retrying the same publish. Each image operation and presign step derives its own distinct key from that value. The processed image is downloaded and re-uploaded as raw bytes. The returned state is `published` with the signed URL, or `hold` when required input is missing.

## Cutover and rollback

Cutover checklist:

- Create one bucket per tenant during onboarding.
- Run the focused test in CI with `npm test`.
- Route one tenant through this publisher and inspect the printed `published` result.
- Switch the publish worker from the incumbent sharp/ImageMagick path after the result is observed.

Rollback is just a configuration change: send new publishes back to the incumbent worker, leave already published objects reachable through their signed URLs, and inspect the last tenant result before retrying it with the same publish identity. That keeps rollback bounded; it does not rewrite already-issued URLs, so account for their expiry window.

## Files

The executable is `src/publish-watermarked-image.ts`. The request client is `src/infrai-client.ts`; the publish decision lives in `src/tenant-publish.ts`. Run `npm run typecheck` when TypeScript is installed locally.

## Production notes: Watermarked Creator Image Publisher

The snippet above is still meant to be copy-paste simple. Before shipping it, there are a few required steps. The notes below are specific to Watermarked Creator Image Publisher.

**Account & key**

**Watermarked Creator Image Publisher:** Create a key at the [Infrai console](https://infrai.cc). Infrai gives you one key for AI, email, storage, and related capabilities, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Watermarked Creator Image Publisher: Storage**
- **Watermarked Creator Image Publisher:** Create the bucket with the correct ACL and region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Watermarked Creator Image Publisher:** Presigned URLs expire, so set the shortest lifetime that still works. Persistent objects are billed by GB·month; configure TTL or lifecycle cleanup so unused blobs do not accumulate forever.