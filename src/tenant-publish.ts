export type PublishRequest = {
  tenantId: string;
  filename: string;
  image: string;
  watermark: string;
  idempotency_key: string;
};

export function publishDecision(input: PublishRequest): "publish" | "hold" {
  return input.tenantId.trim() && input.filename.trim() && input.image.trim() && input.watermark.trim()
    ? "publish"
    : "hold";
}
