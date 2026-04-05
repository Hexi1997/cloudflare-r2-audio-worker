const DEFAULT_CONTENT_TYPE = "audio/mpeg";

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  json: "application/json; charset=utf-8",
};

function getExtension(key: string): string {
  const segments = key.split(".");
  return segments.length > 1 ? segments.at(-1)!.toLowerCase() : "";
}

export function guessContentType(key: string, object?: R2ObjectBody | R2Object | null): string {
  return object?.httpMetadata?.contentType ?? CONTENT_TYPES[getExtension(key)] ?? DEFAULT_CONTENT_TYPE;
}

export function safeObjectKey(rawKey: string): string {
  const decoded = decodeURIComponent(rawKey);
  const normalized = decoded.replace(/^\/+/, "");

  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid object key.");
  }

  return normalized;
}

export function parseRangeHeader(
  rangeHeader: string | null,
  objectSize: number,
): { offset: number; length: number } | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const length = Math.min(suffixLength, objectSize);
    return { offset: objectSize - length, length };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : objectSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= objectSize) {
    return null;
  }

  return { offset: start, length: end - start + 1 };
}

export async function readPlaylistObject(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) {
    throw new Error(`Playlist object "${key}" not found.`);
  }

  return object.json();
}

export async function putObject(bucket: R2Bucket, key: string, body: ReadableStream | ArrayBuffer | string, contentType?: string) {
  await bucket.put(key, body, {
    httpMetadata: {
      contentType: contentType ?? guessContentType(key, null),
    },
  });
}

export async function deleteObject(bucket: R2Bucket, key: string) {
  await bucket.delete(key);
}
