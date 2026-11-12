# Three.js × Remotion 视频实验

`planetary.jsx` 是一份可编辑的 Makaron composition。中心轮 18 齿、固定齿圈 54 齿，中心轮转四圈时行星架转一圈。两版共享几何、相机相对运动与时间轴。讲解版在 3D 画布外叠可编辑文字，无字版将机构居中，作为视频生成模型的运镜参考。

## 本地复现

在此 worktree 安装锁定依赖。加载现有开发环境中的 `REMOTION_FONT_MANIFEST_URL` 或 `REMOTION_LAMBDA_SERVE_URL`，并确保渲染浏览器可以取得对应字体。可选的 `REMOTION_BROWSER_EXECUTABLE` 指向已有 Chrome。

```sh
pnpm install --frozen-lockfile
pnpm exec tsx benchmarks/three-canvas/render.ts
```

该脚本先经过 run_code 同款静态验证与 editable 编译，再通过本地 worker 的实际单帧和视频导出函数制作 `artifacts/three-canvas/` 下的 composition JSON、三张抽帧、讲解 MP4 和无字 MP4。

`routing.ts` 用当前 Makaron 系统提示和 Agent 模型对三个自然语言 brief 做只读选型实验。需配置已有 Agent 模型凭据，执行时会产生推理用量。

```sh
node --import tsx --require ./md-loader.cjs benchmarks/three-canvas/routing.ts
```

## 实测记录

- 内置浏览器运行 Makaron Player；同页调用产品的 `exportDesignVideo` 得到 1920×1080 H.264。本地 worker 和一次性 Vercel Sandbox 均输出 960×540 H.264。对齐 192 帧并归一尺寸后，浏览器与本地导出的平均 SSIM 为 0.982，Sandbox 与本地为 0.981。浏览器首次直连字体源失败，本地验收通过同源提供原始固定字体完成。云端 Sandbox 从已有快照启动，仅在该实例覆盖候选 bundle，渲染后关闭。
- 三个 brief 都没有指定 Three.js。DeepSeek Flash 为镜头拆解和拱门穿越选择 ThreeCanvas，为文字片头选择普通 Remotion 图层。另一次受控源码实验中，模型制作了 6 秒拱门预演。首稿把画布高度误作世界高度，查看首帧后由模型修订机位与几何，最终手工修正了一处材质颜色格式。
- 无字齿轮片按普通视频素材导入 Makaron，SeeDance 2.0 用这条视频生成一条 720p 视频，净计费 322 credits（其中生成 319）。关键帧里构图、三颗行星轮和倾角接近原片，期望的拉丝铝与黄铜质感变化很弱。该次交接从实际导出的 MP4 开始；一轮生产 Agent 从新 composition 自动排队到生成模型的全链路仍待验证。
- Lambda 导出会检查候选 bundle 的 ThreeCanvas 能力标记。该次未向 Lambda 发布候选站点，Lambda 真机导出和 iPhone 播放仍待验收。
