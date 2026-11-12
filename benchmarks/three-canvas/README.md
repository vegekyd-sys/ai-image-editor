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

## 自然语言端到端验收（2026-11-13）

本轮从两个空项目发起真实 `makaron chat`。需求只描述观众、视觉效果与交付物；警匪片明确要求空间预演，两份需求均未指定 Three.js、Remotion、渲染器、生成模型或工具调用顺序。使用此 worktree 的 Agent 服务、一份单独的 Sandbox 快照和独立前缀的 Lambda render site。共享环境变量和生产站点地址保持原值。

| 项目 | Agent 实际选择 | Lambda 实测 |
|---|---|---|
| 科学馆月相展映 | Remotion + SVG，切换轨道俯视与地面观察图，文字录入可编辑 props，加入生成配乐。Agent 经抽帧修改了光线、标注和视角标题 | H.264 1920×1080，30 fps，900 帧，30 秒，AAC。Lambda 渲染 37.0 秒 |
| 雨夜码头警匪片 | ThreeCanvas，低机位积水反射 → 滑过轿车 → 雨棚下两人物对望。Agent 经多轮抽帧调整遮挡、照明和终帧，发布可编辑稿并自行导出无字预演 | H.264 1920×1080，30 fps，240 帧，8 秒。Lambda 渲染 29.6 秒 |

月相任务第一次在本地实验 worker 加载动态 TypeScript 导入时失败。改用项目的完整 tsx loader，核实旧任务尚未提交 AWS 后，重试原任务；相同时间线条目最终完成。码头 Agent 等待导出期间多次调用 materialize，实测仅创建一项导出。随后它在同一轮聊天中读取导出的 MP4，向 Wan 3.0 Prime 提交一次 8 秒参考视频生成。生成任务记录中的来源 snapshot 和视频 URL 均与已导出的 3D 预演吻合。

Wan 返回 1920×1080、240 帧、8.000 秒 H.264 视频及 AAC 音轨。在统一时钟的并排成片中，两版都从低处湿地和右侧警车出发，沿左侧轿车向前移动，最后停在雨棚下的双人对望。生成版保留了左右站位和整体推进方向，重新表现了可辨识的警车、雨幕、箱体与集装箱纹理；车辆比例和构图细节随生成而变化。项目媒体接口确认月相项目有可编辑稿和完整 MP4，码头项目有可编辑稿、预演 MP4 和生成 MP4。本轮 Makaron 净计费分别为 34 和 341 credits。

## 项目内预览

候选版支持用 `/projects/<projectId>?snapshot=<snapshotId>` 打开时间线上的指定稿件。可用 `makaron project media <projectId> --json` 取得对应的 `snapshotId`。链接不改变项目权限；进入项目后仍可切换其他素材。无参数或找不到该稿件时沿用编辑器的默认选择。

验收可编辑 3D 内容时，打开 composition 的链接，在项目画布播放并拖动进度条，对照不同机位的画面。单独播放导出的 MP4 只能验收成片，不能证明可编辑稿已在项目内渲染。上述第一轮的 SVG 月相片只验证了普通合成导出。

在同一个月相项目中保留旧 SVG 稿后，用自然语言要求「用能从不同角度拍摄的 3D 元素」重做，未指定 Three.js。新稿用 ThreeCanvas、球体、方向光和随帧变化的相机完成月相讲解。独立托管 Preview 的项目链接可直接打开可编辑稿；实测未播放时拖至 17 秒，项目画布即从太空机位切到地面所见的盈凸月，继续播放可看到满月。修正前，Player 的首播封面会挡住拖动后的真实画面。

首次导出缺少音轨：稿件持有配乐 URL 却没有 Audio 图层。补入项目既有配乐并重导到同一视频条目后，实测为 1920×1080 H.264、30 fps、900 视频帧、AAC 有声；画面 30 秒，含 AAC 尾部的容器时长 30.037 秒。正式项目页验证成片可播。可编辑 3D 播放和首次拖动的验收环境为独立 Preview，未晋升生产。
