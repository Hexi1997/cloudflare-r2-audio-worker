export interface Env {
  AUDIO_BUCKET: R2Bucket;
  SIGNING_SECRET: string;
  PLAYLIST_KEY?: string;
  ALLOWED_REFERERS?: string;
  BLOCKED_UA_PATTERNS?: string;
  CACHE_TTL_SECONDS?: string;
}

export interface PlaylistTrack {
  key: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  mimeType?: string;
  coverImage?: string;
  [key: string]: unknown;
}

export interface PlaylistDocument {
  items: PlaylistTrack[];
  [key: string]: unknown;
}
