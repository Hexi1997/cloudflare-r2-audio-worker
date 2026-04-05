import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
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

const audioExtensions = new Set(Object.keys(contentTypes).filter((extension) => extension !== ".json"));
const ignoredBaseNames = new Set([".gitkeep", "README.md"]);

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

function shouldUploadAudioFile(filePath) {
  const baseName = path.basename(filePath);
  if (ignoredBaseNames.has(baseName)) {
    return false;
  }

  return audioExtensions.has(path.extname(filePath).toLowerCase());
}

function toSha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function shouldUploadFile(filePath, key) {
  const body = await readFile(filePath);
  const localSha256 = toSha256Hex(body);

  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (head.Metadata?.source_sha256 === localSha256) {
      console.log(`Skipped ${key} (unchanged)`);
      return { shouldUpload: false, body };
    }
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    if (statusCode !== 404) {
      throw error;
    }
  }

  return { shouldUpload: true, body, localSha256 };
}

async function uploadFile(filePath, key) {
  const { shouldUpload, body, localSha256 } = await shouldUploadFile(filePath, key);
  if (!shouldUpload) {
    return false;
  }

  const contentType = contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: {
        source_sha256: localSha256,
      },
      CacheControl: key.endsWith(".json") ? "no-store" : "public, max-age=31536000, immutable",
    },
  });

  await upload.done();
  console.log(`Uploaded ${key}`);
  return true;
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

  for (let index = 0; index < staleKeys.length; index += 1000) {
    const chunk = staleKeys.slice(index, index + 1000);
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

  console.log(`Deleted ${staleKeys.length} stale audio objects`);
}

async function main() {
  const files = await walk(audioDir);
  const expectedKeys = new Set();

  for (const file of files) {
    if (!shouldUploadAudioFile(file)) {
      console.log(`Ignored ${path.relative(audioDir, file)}`);
      continue;
    }

    const relative = path.relative(audioDir, file).split(path.sep).join("/");
    const key = `${audioPrefix}${relative}`;
    expectedKeys.add(key);
    await uploadFile(file, key);
  }

  await uploadFile(playlistFile, "playlist.json");
  await deleteMissingKeys(expectedKeys);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
