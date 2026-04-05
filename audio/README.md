# audio/

把实际音频文件放在这个目录下，并与根目录 `playlist.json` 的 `key` 保持一致。

当前 mock playlist 期望你提供这些文件：

- `audio/episode-001.mp3`
- `audio/episode-002.mp3`
- `audio/trailer.mp3`

说明：

- GitHub Actions 会把这个目录同步到 R2 的 `audio/` 前缀
- Worker 生成的播放地址会基于这些 key
- 如果你改了文件名，也要同步更新 `playlist.json`
