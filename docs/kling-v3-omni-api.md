# Kling VIDEO 3.0 Omni API Reference

> 整理自 https://kling.ai/document-api/apiReference/model/OmniVideo
> 和 https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide
> 日期：2026-04-03

## Endpoint

```
POST https://api-singapore.klingai.com/v1/videos/omni-video
GET  https://api-singapore.klingai.com/v1/videos/omni-video/{task_id}
```

## 模型

| model_name | 说明 |
|---|---|
| `kling-video-o1` | 默认，最高 10s |
| `kling-v3-omni` | 3.0 新模型，最高 15s，支持 Native Audio + Multi-shot |

---

## 五种使用模式

Omni 模型通过 prompt + 不同的 image/video/element 组合实现不同模式。**模式间有互斥关系**。

### 1. Reference（参考图/元素）— 我们现在用的

图片/元素作为参考素材，prompt 用 `<<<image_N>>>` / `<<<element_N>>>` 引用。

```json
{
  "model_name": "kling-v3-omni",
  "prompt": "<<<image_1>>> strolling through Tokyo, encounters <<<element_1>>>",
  "image_list": [
    { "image_url": "xxx" },
    { "image_url": "xxx" }
  ],
  "aspect_ratio": "16:9",
  "duration": "7",
  "mode": "pro",
  "sound": "on"
}
```

**特点**：
- 图片没有 `type` 字段（不设=参考图）
- prompt 用 `<<<image_N>>>` 引用，N 从 1 开始
- **必须指定 `aspect_ratio`**
- 最多 7 张图（无视频时）；有视频时最多 4 张

### 2. Start & End Frames（首尾帧）

图片作为视频的起止画面约束，Kling 生成中间过渡。

```json
{
  "model_name": "kling-v3-omni",
  "prompt": "The person in the video is dancing.",
  "image_list": [
    { "image_url": "xxx", "type": "first_frame" },
    { "image_url": "xxx", "type": "end_frame" }
  ],
  "mode": "pro"
}
```

**特点**：
- `type` 枚举值：`first_frame` 或 `end_frame`（注意不是 last_frame）
- **不支持只有 end_frame**：有尾帧必须有首帧
- 可以只有 first_frame（没有 end_frame）= 传统 image-to-video
- **不需要 `aspect_ratio`**（由图片尺寸决定）
- **不能同时用 video_list（视频编辑）**
- **不能同时用 multi_shot**
- prompt **不用** `<<<image_N>>>`，只描述动作/过渡/镜头
- kling-video-o1 模型下，image_list 超过 2 张时不支持首尾帧

### 3. Video Transformation（视频编辑）

输入一个视频作为 base，通过 prompt 修改内容。

```json
{
  "model_name": "kling-v3-omni",
  "prompt": "Put the crown from <<<image_1>>> on the girl in blue from <<<video_1>>>.",
  "image_list": [{ "image_url": "xxx" }],
  "video_list": [{
    "video_url": "xxx",
    "refer_type": "base",
    "keep_original_sound": "yes"
  }],
  "mode": "pro"
}
```

**特点**：
- `refer_type: "base"` = 视频编辑
- 输出视频时长 = 输入视频时长（duration 参数无效）
- sound 必须 `"off"`（用 keep_original_sound 控制音频）
- **不能设首尾帧**

### 4. Video Reference（视频参考）

用一个视频的风格/镜头运动/内容作为参考，生成新视频。

```json
{
  "model_name": "kling-v3-omni",
  "prompt": "Based on <<<video_1>>>, generate the next shot.",
  "video_list": [{
    "video_url": "xxx",
    "refer_type": "feature",
    "keep_original_sound": "yes"
  }],
  "mode": "pro"
}
```

**特点**：
- `refer_type: "feature"` = 视频参考
- 可以搭配图片和元素
- 可以指定 aspect_ratio 和 duration

### 5. Multi-Shot（分镜叙事）— 3.0 Omni 新增

单次生成多镜头叙事视频，每个镜头有独立 prompt 和时长。

```json
{
  "model_name": "kling-v3-omni",
  "multi_shot": true,
  "shot_type": "customize",
  "prompt": "",
  "multi_prompt": [
    { "index": 1, "prompt": "Wide shot, @Boxer A and @Boxer B face off...", "duration": "2" },
    { "index": 2, "prompt": "Both move in, testing each other...", "duration": "3" },
    { "index": 3, "prompt": "Wide shot, the two continue fighting.", "duration": "3" }
  ],
  "image_list": [
    { "image_url": "xx" },
    { "image_url": "xxx" }
  ],
  "mode": "pro",
  "sound": "on",
  "aspect_ratio": "16:9",
  "duration": "8"
}
```

**特点**：
- `multi_shot: true` + `shot_type: "customize"` 或 `"intelligence"`
- `customize`：用 `multi_prompt` 数组定义每个镜头的 prompt + duration
- `intelligence`：只需写总 prompt，模型自动分镜
- 最多 6 个分镜，每个 duration >= 1s，总和 = 总 duration
- **不支持首尾帧**（明确文档：multi_shot=true 时不支持 start & end frames）
- `prompt` 参数在 customize 模式下无效（用 multi_prompt 代替）
- 最长 15s

---

---

## Image vs Element

### 核心区别

| | Image（`image_list`） | Element（`element_list`） |
|---|---|---|
| **本质** | 一次性参考图，每次请求上传 | **预创建的持久化角色资产**，有 `element_id` |
| **一致性** | 单次请求内参考，跨视频无保证 | 跨多个视频保持角色一致性（Kling 核心能力） |
| **声音** | 不支持 | 可绑定声音（`element_voice_id`），角色说话 |
| **创建方式** | 直接在 request body 传 URL/base64 | 需要先调 Element API 创建，拿到 `element_id` |
| **prompt 引用** | `<<<image_N>>>` | `<<<element_N>>>` 或 `@ElementName` |
| **在 request 中** | `image_list: [{image_url: "..."}]` | `element_list: [{element_id: 12345}]` |
| **持久性** | 无，用完即弃 | 存储在 Kling 账户下，可反复使用 |
| **适用场景** | 场景/风格参考、首尾帧、一次性素材 | 需要跨多个视频保持一致的角色/物品/场景 |

### Element 两种创建方式

**1. Multi-Image Element（`reference_type: "image_refer"`）**
- 上传正面照（`frontal_image`）+ 1-3 张其他角度照片（`refer_images`）
- 适合：人物、物品、动物
- 可选绑定声音（上传 5-30s 语音）

```json
POST /v1/general/advanced-custom-elements
{
  "element_name": "Grace",
  "element_description": "Young woman with ponytail",
  "reference_type": "image_refer",
  "element_image_list": {
    "frontal_image": "https://...",
    "refer_images": [
      {"image_url": "https://...side-view"},
      {"image_url": "https://...back-view"}
    ]
  },
  "element_voice_id": "optional-voice-id",
  "tag_list": [{"tag_id": "o_102"}]
}
```

**2. Video Character Element（`reference_type: "video_refer"`）**
- 上传 3-8s 人物视频，自动提取外貌 + 声音
- 仅支持真人角色（不支持动画/卡通）
- 仅 kling-video-o3 及更新模型支持

```json
{
  "element_name": "Alan",
  "element_description": "Man with curly hair",
  "reference_type": "video_refer",
  "element_video_list": {
    "refer_videos": [{"video_url": "https://..."}]
  }
}
```

### Element 创建流程

1. `POST /v1/general/advanced-custom-elements` → 返回 `task_id`
2. `GET /v1/general/advanced-custom-elements/{task_id}` → 轮询直到 `succeed`
3. 从 `task_result.elements[0].element_id` 拿到 ID
4. 在 omni-video 的 `element_list` 中使用

### Element Tags

| tag_id | 名称 |
|---|---|
| o_102 | Character |
| o_103 | Animal |
| o_104 | Item |
| o_105 | Costume |
| o_106 | Scene |
| o_107 | Effect |
| o_108 | Others |

### Element 数量限制（在 omni-video 中）

- 无视频 + 仅 multi-image element：图片+element 总和 <= 7
- 无视频 + 有 video character element：video character <= 3，图片+multi-image element <= 4
- 有视频：图片+element 总和 <= 4，video character <= 1
- 首尾帧模式 + kling-v3-omni：最多 3 个 element

### 预置 Element

Kling 官方提供预置 element（`owned_by: "kling"`），可通过 `GET /v1/general/advanced-presets-elements` 查询。

### Prompt 中 Image 和 Element 混用示例

```
<<<image_1>>> strolling through the streets of Tokyo,
encountered <<<element_1>>> and <<<element_2>>>,
and jumped into the arms of <<<element_2>>>.
The video style matches that of <<<image_2>>>
```

这里：
- `<<<image_1>>>` = 主角照片（一次性参考）
- `<<<image_2>>>` = 风格参考图
- `<<<element_1>>>` / `<<<element_2>>>` = 预创建的持久化角色

### 对 Makaron 的意义

**现在**：我们用 `image_list` 传用户的 snapshot 作为参考图，每次视频都重新传。

**Element 的价值**：如果用户在多个视频中使用同一个角色（比如吉祥物 Pixel Wizard），可以：
1. 首次使用时创建 Element（上传正面+多角度照片）
2. 后续视频直接传 `element_id`，Kling 保证角色一致性
3. 还可以给角色绑定固定声音

**短期不需要**：Element 需要预创建+管理生命周期，增加复杂度。当前 image_list reference 模式够用。当出现"跨视频角色一致性"需求时再接入。

---

## 互斥关系矩阵

|  | Reference | 首尾帧 | 视频编辑 | 视频参考 | Multi-shot |
|---|---|---|---|---|---|
| **Reference** | - | 不兼容 | 兼容 | 兼容 | 兼容 |
| **首尾帧** | 不兼容 | - | 不兼容 | ? | 不兼容 |
| **视频编辑** | 兼容 | 不兼容 | - | 不兼容 | ? |
| **视频参考** | 兼容 | ? | 不兼容 | - | ? |
| **Multi-shot** | 兼容 | 不兼容 | ? | ? | - |

关键互斥：
- **首尾帧 + Multi-shot = 不兼容**
- **首尾帧 + 视频编辑 = 不兼容**
- **首尾帧 + Reference = 不兼容**（图片只能是帧或参考，不能混用）

---

## image_list.type 字段

| 值 | 含义 | 约束 |
|---|---|---|
| 不设 | 参考图（Reference 模式） | 需要 aspect_ratio |
| `first_frame` | 首帧 | 必须存在 |
| `end_frame` | 尾帧 | 必须同时有 first_frame |

**注意**：`end_frame` 不是 `last_frame`。

---

## Prompt 写法对比

### Reference 模式
```
<<<image_1>>> strolling through the streets of Tokyo, 
encountered <<<element_1>>> and <<<element_2>>>, 
and jumped into the arms of <<<element_2>>>. 
The video style matches that of <<<image_2>>>
```
- 用 `<<<image_N>>>` / `<<<element_N>>>` / `<<<video_N>>>` 引用素材
- 描述完整场景和动作

### 首尾帧模式
```
The person in the video is dancing.
```
- **不引用图片**（图片已经通过 type 指定了角色）
- 只描述动作、过渡、镜头运动
- Kling 自动从首帧过渡到尾帧

### Multi-shot 模式（customize）
```json
[
  { "index": 1, "prompt": "Shot 1 (2s): Wide shot, sunlight streams through windows...", "duration": "2" },
  { "index": 2, "prompt": "Shot 2 (3s): Close-up, their gazes meet...", "duration": "3" },
  { "index": 3, "prompt": "Shot 3 (3s): Cut to wide shot, smiling at each other.", "duration": "3" }
]
```
- 每个镜头独立 prompt + duration
- 可以在镜头内引用 `<<<image_N>>>` / `@Element`
- 时长总和必须等于总 duration

### Multi-shot + Element + 对话（3.0 Omni 最强模式）
```
Shot 1 (3s): Mid-shot, @Grace sits on sofa eating cookies as @Alan walks in holding @Samoyed. 
@Grace says, "Hey! Watch your dog!"
Shot 2 (2s): @Alan sits beside her, pulling the leash. Close-up, @Alan says, "He just likes cookies more than me."
Shot 3 (3s): Close-up, @Grace smiles and says, "Well, he has good taste at least."
```
- Element 用 `@Name` 引用（需要在 Kling element library 创建）
- 支持对话（3.0 Omni 的 Native Audio 能力）
- 镜头语言：Wide shot / Mid-shot / Close-up / Cut to / Bird's-eye view

---

## 其他参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | string | `pro` | `std`=标准（便宜）, `pro`=专业（画质好） |
| `aspect_ratio` | string | - | `16:9`/`9:16`/`1:1`。首尾帧/视频编辑时不需要 |
| `duration` | string | `5` | 3-15s。视频编辑时无效 |
| `sound` | string | `off` | `on`/`off`。有 video_list 时必须 `off` |
| `callback_url` | string | - | 任务完成回调 URL |
| `external_task_id` | string | - | 自定义任务 ID（账户内唯一） |

---

## 图片限制

- 格式：jpg/jpeg/png
- 尺寸：最小 300px，宽高比 1:2.5 ~ 2.5:1
- 大小：<= 10MB
- 数量（无视频时）：最多 7 张图 + element
- 数量（有视频时）：最多 4 张图 + element

## 视频限制

- 格式：MP4/MOV
- 时长：>= 3s
- 分辨率：720-2160px
- 帧率：24-60fps（输出 24fps）
- 最多 1 个视频，<= 200MB

---

## 计费（3.0 Omni）

| | 1080p | 720p |
|---|---|---|
| Native Audio On | 12 Credits/s | 9 Credits/s |
| Native Audio Off | 8 Credits/s | 6 Credits/s |
| 有视频输入 + Audio Off | 16 Credits/s | 12 Credits/s |

---

## 对 Makaron 的影响

### 当前实现
我们用的是 **Reference 模式**：所有图片无 type，prompt 用 `<<<image_N>>>` 引用。
`aspect_ratio` 不传时用 first_frame 类型（自动检测比例），传了就全部是 reference。

### 首尾帧模式接入要点
1. 这是一个**独立模式**，不是在 Reference 上加 type
2. `image_list` 最多 2 张：`[{type: "first_frame"}, {type: "end_frame"}]`
3. prompt 不引用 `<<<image_N>>>`，只描述动作/过渡
4. 不传 `aspect_ratio`
5. 不能和 multi_shot / video_list 同时用
6. API 字段是 `end_frame`（不是 `last_frame`）

### Multi-shot 接入要点
1. `multi_shot: true` + `shot_type: "customize"`
2. `prompt` 留空，用 `multi_prompt` 数组
3. 每个镜头：`{index, prompt, duration}`
4. duration 总和 = 总 duration
5. 最多 6 个分镜，最长 15s
6. **不能和首尾帧同时用**
7. 可以搭配 image_list（reference）和 element_list
