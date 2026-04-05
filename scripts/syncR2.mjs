import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const requiredEnv = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const rootDir = process.env.SYNC_ROOT_DIR ?? process.cwd();
const audioDir = path.resolve(rootDir, process.env.AUDIO_DIR ?? "audio");
const playlistFile = path.resolve(rootDir, process.env.PLAYLIST_FILE ?? "playlist.json");
const audioPrefix = (process.env.AUDIO_PREFIX ?? "audio/").replace(/^\/+/, "").replace(/\/?$/, "/");
const deleteMissing = process.env.DELETE_MISSING === "true";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.R2_BUCKET;

const contentTypes = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".json": "application/json; charset=utf-8",
};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(resolved);
      }
      return [resolved];
    }),
  );

  return files.flat();
}

async function uploadFile(filePath, key) {
  const body = await readFile(filePath);
  const contentType = contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: key.endsWith(".json") ? "no-store" : "public, max-age=31536000, immutable",
    },
  });

  await upload.done();
  console.log(`Uploaded ${key}`);
}

async function listExistingKeys(prefix) {
  const keys = [];
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function deleteMissingKeys(expectedKeys) {
  const existingKeys = await listExistingKeys(audioPrefix);
  const staleKeys = existingKeys.filter((key) => !expectedKeys.has(key));
  if (staleKeys.length === 0) {
    return;
  }

  for (let i = 0; i < staleKeys.length; i += 1000) {
    const chunk = staleKeys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: false,
        },
      }),
    );
  }

  console.log(`Deleted ${staleKeys.length} stale objects`);
}

async function main() {
  const files = await walk(audioDir);
  const uploadedKeys = new Set();

  for (const file of files) {
    const relative = path.relative(audioDir, file).split(path.sep).join("/");
    const key = `${audioPrefix}${relative}`;
    uploadedKeys.add(key);
    await uploadFile(file, key);
  }

  await uploadFile(playlistFile, "playlist.json");

  if (deleteMissing) {
    await deleteMissingKeys(uploadedKeys);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
