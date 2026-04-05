# cloudflare-r2-audio-worker

基于 Cloudflare Workers + R2 的轻量级音频分发服务，支持：

- R2 音频分发
- HMAC 签名 URL
- Referrer + UA 防盗链
- `Range` 流式播放
- `/playlist.json` 返回静态播放列表元数据
- `/track-url/:key` 按需签发临时音频地址
- GitHub Actions 自动同步 `audio/` 目录到 R2

## API

### 获取播放列表元数据

```http
GET /playlist.json
```

只返回静态元数据，不返回临时 MP3 地址。

### 获取单条音频的临时播放地址

```http
GET /track-url/:key
```

例如当 `key` 为 `audio/episode-001.mp3` 时，请求路径为：

```http
GET /track-url/audio%2Fepisode-001.mp3
```

返回示例：

```json
{
  "key": "audio/episode-001.mp3",
  "url": "https://your-worker.workers.dev/audio/audio%2Fepisode-001.mp3?exp=1719999999&sig=xxx",
  "expiresAt": "2026-04-04T14:00:00.000Z"
}
```

### 获取音频

```http
GET /audio/:key?exp=1719999999&sig=xxx
```

要求：

- 必须带有效签名
- 必须带允许的 `Referer`
- UA 不能命中黑名单
- 支持 `Range: bytes=...`

## 前端调用流程

1. 请求 `/playlist.json` 获取条目和元数据
2. 用户点击播放时，请求 `/track-url/${encodeURIComponent(key)}`
3. 把返回的 `url` 塞给 `<audio>`
4. 如果播放时因过期返回 403，再重新请求一次 `/track-url/...`

## 环境准备

```bash
pnpm install
wrangler secret put SIGNING_SECRET
```

可选变量：

- `PLAYLIST_KEY`: 默认为 `playlist.json`
- `ALLOWED_REFERERS`: 逗号分隔，如 `https://example.com,http://localhost:3000`
- `BLOCKED_UA_PATTERNS`: 逗号分隔正则片段
- `CACHE_TTL_SECONDS`: 音频缓存 TTL，默认 31536000

## 自动同步

默认工作流会：

- 扫描仓库里的 `audio/` 目录
- 只上传音频文件到 R2 的 `audio/` 前缀
- 自动忽略 `README.md`、`.gitkeep` 等非音频文件
- 基于文件内容 hash 跳过未变化的音频，避免每次全量上传
- 自动删除 R2 中已经不在仓库里的旧音频对象
- 上传根目录 `playlist.json`
