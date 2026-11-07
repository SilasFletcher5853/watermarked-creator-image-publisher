import { InfraiClient } from "./infrai-client.ts";
import { publishDecision, type PublishRequest } from "./tenant-publish.ts";
import { z } from "zod";

type UploadResult = { image_id: string; url: string };
type WatermarkResult = { image_id?: string; url?: string };
type PresignResult = { url: string };

function requestBody(): PublishRequest {
  const input = process.env.PUBLISH_REQUEST;
  if (!input) throw new Error("PUBLISH_REQUEST must contain a JSON request");
  const parsed = z.object({
    tenantId: z.string().min(1),
    filename: z.string().min(1),
    image: z.string().min(1),
    watermark: z.string().min(1),
    idempotency_key: z.string().min(1)
  }).parse(JSON.parse(input));
  return {
    tenantId: parsed.tenantId,
    filename: parsed.filename,
    image: parsed.image,
    watermark: parsed.watermark,
    idempotency_key: parsed.idempotency_key
  };
}

export async function publishImage(input: PublishRequest, client: InfraiClient): Promise<{ state: string; downloadUrl: string }> {
  if (publishDecision(input) === "hold") return { state: "hold", downloadUrl: "" };
  const bucket = `tenant-${input.tenantId}`;
  const uploaded = await client.request<UploadResult>("POST", "/image/upload", { file: input.image, filename: input.filename, idempotency_key: `${input.idempotency_key}:upload` });
  const watermarked = await client.request<WatermarkResult>("POST", "/image/watermark", {
    image: uploaded.image_id ? { image_id: uploaded.image_id } : { url: uploaded.url },
    text: input.watermark,
    position: "bottom_right",
    opacity: 0.8,
    idempotency_key: `${input.idempotency_key}:watermark`
  });
  const objectPath = `/storage/object/presign/${bucket}/${encodeURIComponent(input.filename)}`;
  const put = await client.request<PresignResult>("POST", objectPath, {
    op: "put",
    content_type: "application/octet-stream",
    idempotency_key: `${input.idempotency_key}:presign-put`
  });
  const processed = watermarked.url ? watermarked : watermarked.image_id
    ? await client.request<WatermarkResult>("GET", `/image/get/${encodeURIComponent(watermarked.image_id)}`)
    : undefined;
  if (!processed?.url) throw new Error("Watermark response did not include a downloadable image");
  const imageResponse = await fetch(processed.url);
  if (!imageResponse.ok) throw new Error(`Image download failed with status ${imageResponse.status}`);
  await client.uploadPresigned(put.url, await imageResponse.arrayBuffer());
  const signed = await client.request<PresignResult>("POST", objectPath, {
    op: "get",
    expires_seconds: 900,
    response_disposition: "inline",
    idempotency_key: `${input.idempotency_key}:presign-get`
  });
  return { state: "published", downloadUrl: signed.url };
}

if (import.meta.main) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const result = await publishImage(requestBody(), new InfraiClient(key));
  console.log(JSON.stringify(result));
}
