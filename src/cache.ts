const CACHE_VERSION = "v1";
const EDGE_CACHE_NAME = "audio-edge-cache";

export function buildCacheHeaders(ttlSeconds: number): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", `public, max-age=${ttlSeconds}, immutable`);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Vary", "Range");
  return headers;
}

export function buildEdgeCacheKey(request: Request, pathname: string): Request {
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `/__edge-cache/${CACHE_VERSION}${pathname}`;
  cacheUrl.search = "";
  return new Request(cacheUrl.toString(), { method: "GET" });
}

async function openAudioCache(): Promise<Cache> {
  return caches.open(EDGE_CACHE_NAME);
}

export async function getCachedAudio(cacheKey: Request): Promise<Response | null> {
  const cache = await openAudioCache();
  return (await cache.match(cacheKey)) ?? null;
}

export async function putCachedAudio(cacheKey: Request, response: Response): Promise<void> {
  const cache = await openAudioCache();
  await cache.put(cacheKey, response);
}
