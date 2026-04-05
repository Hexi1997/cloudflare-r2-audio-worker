---

title: 'PRD: cloudflare-r2-audio-worker' date: '2026-04-04' tags:

- 'Cloudflare'
- 'R2'
- 'Audio'
- 'Serverless'

---

# 📄 项目名称

**cloudflare-r2-audio-worker**

# 🧭 项目概述

基于 Cloudflare R2 + Workers 构建的轻量级音频分发服务，支持 CDN 缓存、签名 URL、防盗链、流式播放，并可通过 GitHub 仓库管理音频文件实现自动同步。

# 🎯 项目目标

## 核心目标

- 提供可直接部署的音频分发后端
- 支持 CDN 加速与缓存
- 支持签名 URL 防盗链与防刷
- 支持 Range 流式播放
- 允许用户通过 GitHub 仓库管理 MP3 文件并自动同步到 R2

## 非目标

- 不提供复杂音乐推荐系统
- 不提供用户管理或社交功能
- 不做重型后端或数据库存储

# 👤 目标用户

- 独立开发者、网站管理员、播客或个人音乐合集管理者
- SaaS 或 Web3 内容平台开发者

# 🧩 核心功能

## 1. 音频分发

- 从 R2 获取 MP3 并返回给客户端
- 支持 `<audio>` 标签播放
- 支持 Range 请求

## 2. CDN 缓存

- 利用 Cloudflare Edge Cache
- Cache-Control: `public, max-age=31536000, immutable`
- 目标 CDN 命中率 ≥ 90%

## 3. 签名 URL（防盗链）

- URL 格式：`/audio/:key?exp=xxx&sig=xxx`
- exp: 过期时间（unix timestamp）
- sig: HMAC-SHA256(path + exp)
- 无签名或过期签名访问返回 403

## 4. 防刷机制

- Referrer 校验（必选）
- UA 过滤（阻止 curl/python/wget 等）
- 不使用 Rate Limit / KV

## 5. R2 存储接入

- 通过 Worker binding 访问 R2
- 支持覆盖上传和删除文件

## 6. GitHub 仓库自动同步

- 用户在 GitHub 仓库维护音频文件和 playlist.json
- GitHub Actions 监听提交自动同步 R2
- Worker 根据 R2 生成签名 URL playlist.json 供前端使用

## 7. Content-Type 自动识别

- 默认 audio/mpeg
- 可扩展支持 wav/ogg 等格式

# 🔌 API 设计

### 1. 获取音频

```
GET /audio/:key?exp=xxx&sig=xxx
```

### 2. 获取播放列表

```
GET /playlist.json
```

- 返回 JSON，包含签名 URL 和元信息

### 3. 可选手动同步

```
POST /sync
```

- 手动触发 GitHub 到 R2 的同步

# 🏗️ 技术架构

```
Browser (Audio Player)
   ↓
Cloudflare CDN
   ↓ (cache miss)
Worker (签名 URL + Referrer 校验 + 缓存)
   ↓
Cloudflare R2 (音频存储)
```

# ⚙️ 技术选型

| 模块   | 技术                         |
| ---- | -------------------------- |
| 边缘计算 | Cloudflare Workers         |
| 存储   | Cloudflare R2              |
| 缓存   | Cloudflare CDN + Cache API |
| 签名   | Web Crypto (HMAC-SHA256)   |
| 自动同步 | GitHub Actions             |
| 防刷   | Referrer 校验 + UA 过滤        |

# 🧱 项目结构

```
cloudflare-r2-audio-worker/
├── src/
│   ├── index.ts          # Worker 入口
│   ├── auth.ts           # 签名校验
│   ├── cache.ts          # 缓存策略
│   ├── r2.ts             # R2 访问
├── utils/
│   └── sign.ts           # 签名生成
├── scripts/
│   └── syncR2.js         # GitHub Action 同步逻辑
├── wrangler.toml
├── README.md
```

# 🔐 安全设计

| 风险     | 解决方案                |
| ------ | ------------------- |
| 盗链     | 签名 URL              |
| URL 猜测 | exp + sig           |
| 非授权访问  | Referrer 校验 + UA 过滤 |
| CDN 绕过 | 禁止无签名访问             |

# 📈 性能指标

| 指标        | 目标     |
| --------- | ------ |
| CDN 命中率   | ≥ 90%  |
| Worker 响应 | < 50ms |
| R2 回源比例   | < 10%  |

# 🧪 测试方案

- 正常播放测试
- Range 请求拖动测试
- 无签名/过期签名访问测试（403）
- 并发压测（1000+ 请求）检查 CDN 命中率

# 📦 部署方案

- 使用 GitHub Actions 自动部署 Worker
- 通过 Cloudflare API Token 发布到指定账号和 R2
- 可在 Action 中配置分支监听与自动同步

# 💡 项目亮点

- ⚡ Edge-native（全球加速）
- 💰 超低成本（CDN 优先）
- 🔐 内置防盗链
- 🎧 原生支持音频流
- 🧩 GitHub Repo 自动同步管理
- 🛠️ 可直接开箱部署

