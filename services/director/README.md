# Director 私有预览

要求 Node 24、Makaron 开发环境和专用持久化目录。安装此目录的 npm 依赖并执行 `npm run build`。在仓库根执行下列命令启动单实例服务。

```sh
node --env-file=/path/to/private.env --import tsx services/director/start.ts
```

环境文件提供 Makaron 既有 Supabase 服务配置、开发环境 FAL_KEY、DEEPSEEK_API_KEY 和独立播放器语音所用 DASHSCOPE_API_KEY。设置 MAKARON_DIRECTOR_PREVIEW_KEY_IDS（已启用的 Makaron key 记录 ID）、MAKARON_DIRECTOR_STATE_DIR（服务账户的专用目录），以及可选的 MAKARON_DIRECTOR_PORT（默认 43936）。服务只监听 loopback。客户端通过 MAKARON_DIRECTOR_URL 访问隔离实例，普通图片上传和固定时长视频保持原 Makaron 地址。

```sh
export MAKARON_DIRECTOR_URL=http://127.0.0.1:43936
node packages/makaron-cli/bin/makaron.mjs director start --prompt '雨里的花店' --open
```

开播命令创建会话。播放器打开时才提交唯一一次 WebRTC offer，随后接收媒体并录制。当前预览每场最多两分钟，结束后可从 CLI 导出播放器实际保存的格式。服务端保存开发录像与会话状态于专用目录；播放器关闭前应先收播并等待录像保存成功。部署面向客户的版本前需接入 Makaron 正式计费与存储生命周期。此次预览由开发环境承担供应商费用。
