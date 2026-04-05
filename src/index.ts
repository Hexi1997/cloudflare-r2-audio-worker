import { signPath, validateAntiLeeching, verifySignedRequest } from "./auth";
import { buildCacheHeaders, buildEdgeCacheKey, getCachedAudio, putCachedAudio } from "./cache";
import { guessContentType, parseRangeHeader, readPlaylistObject, safeObjectKey } from "./r2";
import type { Env, PlaylistDocument, PlaylistTrack } from "./types";

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function text(message: string, status = 200, headers?: HeadersInit): Response {
  return new Response(message, { status, headers });
}

function getAllowedReferers(env: Env): string[] {
  return (env.ALLOWED_REFERERS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getBlockedUaPatterns(env: Env): RegExp[] {
  return (env.BLOCKED_UA_PATTERNS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new RegExp(item, "i"));
}

function getCacheTtl(env: Env): number {
  const ttl = Number(env.CACHE_TTL_SECONDS ?? "31536000");
  return Number.isFinite(ttl) && ttl > 0 ? ttl : 31536000;
}

function normalizePlaylist(data: unknown): PlaylistDocument {
  if (Array.isArray(data)) {
    return { items: data as PlaylistTrack[] };
  }

  if (!data || typeof data !== "object" || !Array.isArray((data as PlaylistDocument).items)) {
    throw new Error("playlist.json must be an array or an object with an items array.");
  }

  return data as PlaylistDocument;
}

async function readNormalizedPlaylist(env: Env): Promise<PlaylistDocument> {
  const playlistKey = env.PLAYLIST_KEY ?? "playlist.json";
  return normalizePlaylist(await readPlaylistObject(env.AUDIO_BUCKET, playlistKey));
}

async function handleAudio(request: Request, env: Env, key: string): Promise<Response> {
  const signed = await verifySignedRequest(request, env.SIGNING_SECRET);
  if (!signed.ok) {
    return text(signed.reason, 403);
  }

  const antiLeech = validateAntiLeeching(request, getAllowedReferers(env), getBlockedUaPatterns(env));
  if (!antiLeech.ok) {
    return text(antiLeech.reason, 403);
  }

  const objectKey = safeObjectKey(key);
  const head = await env.AUDIO_BUCKET.head(objectKey);
  if (!head) {
    return text("Audio object not found.", 404);
  }

  const rangeRequest = parseRangeHeader(request.headers.get("range"), head.size);
  if (request.headers.has("range") && !rangeRequest) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${head.size}`,
      },
    });
  }

  const contentType = guessContentType(objectKey, head);
  const cacheHeaders = buildCacheHeaders(getCacheTtl(env));
  const filename = objectKey.split("/").at(-1) ?? "audio";

  if (!rangeRequest) {
    const cacheKey = buildEdgeCacheKey(request, new URL(request.url).pathname);
    const cached = await getCachedAudio(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("Content-Disposition", `inline; filename="${filename}"`);
      return new Response(cached.body, { status: cached.status, headers });
    }

    const object = await env.AUDIO_BUCKET.get(objectKey);
    if (!object?.body) {
      return text("Audio object not found.", 404);
    }

    const headers = new Headers(cacheHeaders);
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(object.size));
    headers.set("ETag", object.httpEtag);
    headers.set("Content-Disposition", `inline; filename="${filename}"`);

    const response = new Response(object.body, { status: 200, headers });
    await putCachedAudio(cacheKey, response.clone());
    return response;
  }

  const object = await env.AUDIO_BUCKET.get(objectKey, { range: rangeRequest });
  if (!object?.body) {
    return text("Audio object not found.", 404);
  }

  const end = rangeRequest.offset + rangeRequest.length - 1;
  const headers = new Headers(cacheHeaders);
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(rangeRequest.length));
  headers.set("Content-Range", `bytes ${rangeRequest.offset}-${end}/${head.size}`);
  headers.set("Content-Disposition", `inline; filename="${filename}"`);
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: 206, headers });
}

async function handlePlaylist(env: Env): Promise<Response> {
  const playlistDoc = await readNormalizedPlaylist(env);
  return json(playlistDoc, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function handleTrackUrl(request: Request, env: Env, rawKey: string): Promise<Response> {
  const objectKey = safeObjectKey(rawKey);
  const playlistDoc = await readNormalizedPlaylist(env);
  const exists = playlistDoc.items.some((track) => track.key === objectKey);
  if (!exists) {
    return text("Track not found in playlist.", 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60;
  const pathname = `/audio/${encodeURIComponent(objectKey)}`;
  const sig = await signPath(pathname, exp, env.SIGNING_SECRET);
  const origin = new URL(request.url).origin;

  return json(
    {
      key: objectKey,
      url: `${origin}${pathname}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function handleOptions(): Response {
  return new Response(null, {
    headers: {
      Allow: "GET,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname.startsWith("/audio/")) {
        return handleAudio(request, env as Env, pathname.replace("/audio/", ""));
      }

      if (request.method === "GET" && pathname === "/playlist.json") {
        return handlePlaylist(env as Env);
      }

      if (request.method === "GET" && pathname.startsWith("/track-url/")) {
        return handleTrackUrl(request, env as Env, pathname.replace("/track-url/", ""));
      }

      if (request.method === "GET" && pathname === "/healthz") {
        return json({ ok: true, service: "cloudflare-r2-audio-worker" });
      }

      return text("Not found.", 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return json({ ok: false, error: message }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
