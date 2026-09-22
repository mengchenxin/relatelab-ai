const maximumImageBytes = 6 * 1024 * 1024;

export interface ValidatedImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
}

function hasPngSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
}

function hasJpegSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function hasWebpSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function validateImageDataUrl(dataUrl: string): ValidatedImage {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) {
    throw new Error("仅支持 PNG、JPEG 或 WebP 格式的聊天截图。");
  }

  const declaredMime = match[1] as ValidatedImage["mimeType"];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > maximumImageBytes) {
    throw new Error("聊天截图不能超过 6 MB。");
  }

  const detectedMime = hasPngSignature(bytes)
    ? "image/png"
    : hasJpegSignature(bytes)
      ? "image/jpeg"
      : hasWebpSignature(bytes)
        ? "image/webp"
        : null;

  if (!detectedMime || detectedMime !== declaredMime) {
    throw new Error("图片内容与文件格式不匹配或格式不受支持。");
  }

  return {
    mimeType: detectedMime,
    byteLength: bytes.length
  };
}
