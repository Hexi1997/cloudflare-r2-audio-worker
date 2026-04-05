const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function buildSignaturePayload(pathname: string, exp: string | number): string {
  return `${pathname}:${exp}`;
}

export async function signPath(pathname: string, exp: string | number, secret: string): Promise<string> {
  const key = await importSecret(secret);
  const payload = buildSignaturePayload(pathname, exp);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifySignedRequest(
  request: Request,
  secret: string,
): Promise<{ ok: true; exp: number } | { ok: false; reason: string }> {
  const url = new URL(request.url);
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");

  if (!exp || !sig) {
    return { ok: false, reason: "Missing exp or sig query parameter." };
  }

  const expValue = Number(exp);
  if (!Number.isFinite(expValue)) {
    return { ok: false, reason: "Invalid exp query parameter." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (expValue <= now) {
    return { ok: false, reason: "Signed URL expired." };
  }

  const expected = await signPath(url.pathname, exp, secret);
  if (sig !== expected) {
    return { ok: false, reason: "Signature mismatch." };
  }

  return { ok: true, exp: expValue };
}

export function requireAdminToken(request: Request, adminToken?: string): boolean {
  if (!adminToken) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length) === adminToken;
  }

  const url = new URL(request.url);
  return url.searchParams.get("token") === adminToken;
}

export function validateAntiLeeching(request: Request, allowedReferers: string[], blockedUaPatterns: RegExp[]) {
  const referer = request.headers.get("referer");
  if (!referer) {
    return { ok: false, reason: "Missing referer." };
  }

  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    return { ok: false, reason: "Invalid referer." };
  }

  const refererOrigin = refererUrl.origin.toLowerCase();
  const isAllowed = allowedReferers.some((item) => refererOrigin === item || refererOrigin.startsWith(item));
  if (!isAllowed) {
    return { ok: false, reason: "Referer is not allowed." };
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  if (blockedUaPatterns.some((pattern) => pattern.test(userAgent))) {
    return { ok: false, reason: "Blocked user agent." };
  }

  return { ok: true } as const;
}
