# Model list

> The complete documentation index is available at [llms.txt](https://ai.byteplus.com/ark/llms.txt). Append `.md` to any documentation page URL to get its Markdown version.

ModelArk provides models for text and code, video, image, 3D, and embedding workloads. Compare the capabilities and limits in each section to select a model.

<span id="featured-models"></span>
## Featured models

**[Dola Seed 2.1 Turbo](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seed-2-1-turbo)**

* **Best for:** General-purpose agentic workloads
* **Key capabilities:** Deep reasoning, multimodal understanding, tool use, and structured output
* **Key limits:** 256K context, 256K max output (incl. CoT), and 0.5K max RPM

**[Dreamina Seedance 2.5](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-5)**

* **Best for:** Video generation and editing
* **Key capabilities:** Reference-to-video, video editing, video extension, image-to-video, and text-to-video
* **Key limits:** Up to 1080p, 4-30 seconds, and 0.6K default max RPM for enterprise users

**[Dola Seedream 5.0 Pro](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seedream-5-0-pro)**

* **Best for:** Image generation and layer decomposition
* **Key capabilities:** Text-to-image, single-reference image-to-image, and multi-reference image-to-image
* **Key limit:** 500 max IPM

> **Note: Tip**
>
> * **Region availability**:
>     * Currently, all the models listed in [Model list](/docs/model-list) are supported in the `ap-southeast-1` region.
>     * The seed-2-0 and seedream-5-0-lite models are also supported in the `eu-west-1` region.
> * Base URL by region:
>     * `ap-southeast-1`: `https://ark.ap-southeast.bytepluses.com/api/v3`
>     * `eu-west-1`: `https://ark.eu-west.bytepluses.com/api/v3`
>
> For more information, see [Region availability](/docs/region-availability).

> **Warning: Rate limits**
>
> The rate limits in this document are theoretical maximum values. Actual limits depend on platform load and the invocation method. For details, see [Best practices for handling burst traffic](/docs/traffic-burst-handling-best-practices).

<span id="text-and-code"></span><span id="32e9e053"></span>
## Text and code generation

Tutorials: [Text generation](/docs/text-generation) | [Image understanding](/docs/image-understanding) | [Video understanding](/docs/video-understanding) | [Document understanding](/docs/document-understanding) | [Audio understanding](/docs/audio-understanding) | [Structured output (beta)](/docs/structured-output-beta)
API documentation: [Chat API](/docs/chat-api) | [Responses API](/docs/create-model-responses-api) | [Messages API](/docs/messages-api)

<span id="text-code-capabilities"></span><span id="76df97c8"></span><span id="9619c0ba"></span><span id="f2b7c91d"></span><span id="86588b72"></span>
### Capabilities

| Provider | Model ID | Deep | Visual | Audio | Structured | \
| | | reasoning | understanding | understanding | output |
| --- | --- | --- | --- | --- | --- |
| ByteDance | [`dola-seed-2-1-turbo-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seed-2-1-turbo) | Yes | Yes | No | Yes |
| ^^ | [`seed-2-0-lite-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-lite) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes | Yes | `json_schema` recommended |
| ^^ | [`seed-2-0-mini-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-mini) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes | Yes | `json_schema` recommended |
| ^^ | [`seed-2-0-code-preview-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-code) | Yes | Yes | No | No |
| ^^ | [`seed-2-0-pro-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-pro) | Yes | Yes | No | No |
| DeepSeek | [`deepseek-v4-1-flash-economy-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash-economy) | Yes | Yes | No | Yes |
| ^^ | [`deepseek-v4-1-flash-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes | No | Yes |
| ^^ | [`deepseek-v4-1-flash-260910`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes | No | Yes |
| ^^ | [`deepseek-v4-pro-ga-260813`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro-ga) | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-flash-ga-260731`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash-ga) | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-flash-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash) | Yes | No | No | No |
| ^^ | [`deepseek-v4-pro-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro) | Yes | No | No | No |
| Z.ai | [`glm-5-3-flash-260828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-3-flash) | Yes | Yes | No | No |
| ^^ | [`glm-5-2-260617`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-2) | Yes | No | No | Yes |

<span id="text-code-limits"></span>
### Limits

The default output is 4K for all models unless otherwise specified. Max output includes CoT.

| Provider | Model ID | Context | Max input | Max output | Max CoT | Max RPM | Max TPM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ByteDance | [`dola-seed-2-1-turbo-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seed-2-1-turbo) | 256K | 256K | 256K | 256K | 0.5K | 1000K |
| ^^ | [`seed-2-0-lite-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-lite) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | 256K | 224K | 128K | 128K | 30K | 1500K |
| ^^ | [`seed-2-0-mini-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-mini) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | 256K | 224K | 128K | 128K | 30K | 1500K |
| ^^ | [`seed-2-0-code-preview-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-code) | 256K | 224K | 128K | 128K | 30K | 1500K |
| ^^ | [`seed-2-0-pro-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-pro) | 256K | 224K | 128K | 128K | 30K | 1500K |
| DeepSeek | [`deepseek-v4-1-flash-economy-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash-economy) | 1024K | 1024K | 384K | 128K | 3K | 5000K |
| ^^ | [`deepseek-v4-1-flash-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | 1024K | 1024K | 384K | 128K | 3K | 5000K |
| ^^ | [`deepseek-v4-1-flash-260910`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | 1024K | 1024K | 384K | 128K | 3K | 5000K |
| ^^ | [`deepseek-v4-pro-ga-260813`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro-ga) | 1024K | 1024K | 384K | 128K | 0.5K | 1000K |
| ^^ | [`deepseek-v4-flash-ga-260731`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash-ga) | 1024K | 1024K | 384K | 128K | 0.5K | 1000K |
| ^^ | [`deepseek-v4-flash-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash) | 1024K | 1024K | 384K | 128K | 15K | 1500K |
| ^^ | [`deepseek-v4-pro-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro) | 1024K | 1024K | 384K | 128K | 15K | 1500K |
| Z.ai | [`glm-5-3-flash-260828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-3-flash) | 1024K | 1024K | 128K | 128K | 0.5K | 1000K |
| ^^ | [`glm-5-2-260617`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-2) | 1024K | 1024K | 128K | 128K | 0.5K | 1000K |

<span id="text-code-tool-use"></span><span id="42df3eb4"></span><span id="f44ceef7"></span>
### Tool use

Tutorials: [Function call](/docs/function-calling) | [Cloud-deployed MCP / remote MCP](/docs/mcp-remote-mcp)

| Provider | Model ID | Function calling | MCP |
| --- | --- | --- | --- |
| ByteDance | [`dola-seed-2-1-turbo-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seed-2-1-turbo) | Yes | Yes |
| ^^ | [`seed-2-0-lite-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-lite) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes |
| ^^ | [`seed-2-0-mini-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-mini) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes |
| ^^ | [`seed-2-0-code-preview-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-code) | Yes | No |
| ^^ | [`seed-2-0-pro-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-pro) | Yes | Yes |
| DeepSeek | [`deepseek-v4-1-flash-economy-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash-economy) | Yes | Yes |
| ^^ | [`deepseek-v4-1-flash-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes |
| ^^ | [`deepseek-v4-1-flash-260910`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes |
| ^^ | [`deepseek-v4-pro-ga-260813`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro-ga) | Yes | Yes |
| ^^ | [`deepseek-v4-flash-ga-260731`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash-ga) | Yes | Yes |
| ^^ | [`deepseek-v4-flash-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash) | Yes | Yes |
| ^^ | [`deepseek-v4-pro-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro) | Yes | Yes |
| Z.ai | [`glm-5-3-flash-260828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-3-flash) | Yes | Yes |
| ^^ | [`glm-5-2-260617`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-2) | Yes | Yes |

<span id="text-code-context-caching"></span><span id="ed095742"></span>
### Context caching

Tutorials: [Context cache](/docs/context-cache)
API documentation: [Chat API](/docs/chat-api) | [Responses API](/docs/create-model-responses-api) | [Messages API](/docs/messages-api) | [Batch API](/docs/batch-chat-api)

> **Note: Tip**
>
> For available models, implicit caching can be used with the [Chat API](/docs/chat-api), [Responses API](/docs/create-model-responses-api), [Messages API](/docs/messages-api), or [Batch API](/docs/batch-chat-api), depending on the model. Explicit caching uses the [Responses API](/docs/create-model-responses-api), and every model that supports explicit caching supports both prefix caching and session caching.

| Provider | Model ID | Implicit caching |||| Explicit caching |
| --- | --- | --- | --- | --- | --- | --- |
| Supported API || Chat | Responses | Messages | Batch | Responses |
| ByteDance | [`dola-seed-2-1-turbo-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seed-2-1-turbo) | Yes | Yes | No | Yes | Yes |
| ^^ | [`seed-2-0-lite-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-lite) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes | No | No | Yes |
| ^^ | [`seed-2-0-mini-260428`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-mini) [<span data-label="purple">LTS</span>](/docs/lts-mechanism#lts-model-list) | Yes | Yes | No | No | Yes |
| ^^ | [`seed-2-0-code-preview-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-code) | No | No | No | No | Yes |
| ^^ | [`seed-2-0-pro-260328`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seed-2-0-pro) | No | No | No | No | Yes |
| DeepSeek | [`deepseek-v4-1-flash-economy-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash-economy) | Yes | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-1-flash-261017`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-1-flash-260910`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-1-flash) | Yes | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-pro-ga-260813`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro-ga) | Yes | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-flash-ga-260731`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash-ga) | Yes | Yes | No | No | Yes |
| ^^ | [`deepseek-v4-flash-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-flash) | Yes | No | No | No | Yes |
| ^^ | [`deepseek-v4-pro-260425`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=deepseek-v4-pro) | Yes | No | No | No | Yes |
| Z.ai | [`glm-5-3-flash-260828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-3-flash) | Yes | Yes | Yes | No | Yes |
| ^^ | [`glm-5-2-260617`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=glm-5-2) | Yes | Yes | No | No | Yes |

<span id="video-generation"></span><span id="7571da3f"></span>
## Video generation

Tutorials: [Video generation tutorial](/docs/video-generation-tutorial) | [Dreamina Seedance 2.5 tutorial](/docs/seedance-2-5) | [Dreamina Seedance 2.5 prompt guide](/docs/seedance-2-5-prompt-guide)
API documentation: [Create task](/docs/create-video-generation-task-api) | [List tasks](/docs/list-video-generation-tasks-api) | [Get task](/docs/get-video-generation-task-api) | [Cancel or delete task](/docs/cancel-or-delete-video-generation-tasks-api)

<span id="video-generation-capabilities"></span>
### Capabilities

| Model ID | Text-to-video | First-frame-to-video | First-last-frame-to-video | Reference-to-video | Video editing | Video extension |
| --- | --- | --- | --- | --- | --- | --- |
| [`dreamina-seedance-2-5-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-5) | Yes | Yes | Yes | Yes | Yes | Yes |
| [`dreamina-seedance-2-0-mini-260615`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) | Yes | Yes | Yes | Yes | Yes | Yes |
| [`dreamina-seedance-2-0-fast-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) | Yes | Yes | Yes | Yes | Yes | Yes |
| [`dreamina-seedance-2-0-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) | Yes | Yes | Yes | Yes | Yes | Yes |
| [`seedance-1-0-pro-fast-251015`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast) | Yes | Yes | No | No | No | No |
| [`seedance-1-0-pro-250528`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro) | Yes | Yes | Yes | No | No | No |

<span id="video-generation-output"></span>
### Output

| Model ID | Format | Resolution | Frame rate | Duration |
| --- | --- | --- | --- | --- |
| [`dreamina-seedance-2-5-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-5) | `.mp4` | 480p (8-bit) | 24 fps | 4-30 seconds | \
| | `.mov` | 720p (8-bit) | | | \
| | | 1080p (10-bit) | | |
| [`dreamina-seedance-2-0-mini-260615`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) | `.mp4` | 480p (8-bit) | 24 fps | 4-15 seconds | \
| | | 720p (8-bit) | | |
| [`dreamina-seedance-2-0-fast-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) | `.mp4` | 480p (8-bit) | 24 fps | 4-15 seconds | \
| | | 720p (8-bit) | | |
| [`dreamina-seedance-2-0-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) | `.mp4` | 480p (8-bit) | 24 fps | 4-15 seconds | \
| | | 720p (8-bit) | | | \
| | | 1080p (8-bit) | | | \
| | | 4K (10-bit) | | |
| [`seedance-1-0-pro-fast-251015`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast) | `.mp4` | 480p | 24 fps | 2-12 seconds | \
| | | 720p | | | \
| | | 1080p | | |
| [`seedance-1-0-pro-250528`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro) | `.mp4` | 480p | 24 fps | 2-12 seconds | \
| | | 720p | | | \
| | | 1080p | | |

<span id="video-generation-limits"></span>
### Limits

| Model ID | Default || Flex |
| --- | --- | --- | --- |
| | Max RPM | Max concurrency | |
| [`dreamina-seedance-2-5-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-5) | Enterprise: 600 | Enterprise: 10 | Not supported | \
| | Individual: 180 | Individual: 3 | |
| [`dreamina-seedance-2-0-mini-260615`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) | Enterprise: 600 | Enterprise: 10 | Not supported | \
| | Individual: 180 | Individual: 3 | |
| [`dreamina-seedance-2-0-fast-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) | Enterprise: 600 | Enterprise: 10 | Not supported | \
| | Individual: 180 | Individual: 3 | |
| [`dreamina-seedance-2-0-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) | Non-4K enterprise: 600 | Non-4K enterprise: 10 | Not supported | \
| | Non-4K individual: 180 | Non-4K individual: 3 | | \
| | 4K, all users: 15 | 4K, all users: 1 | |
| [`seedance-1-0-pro-fast-251015`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast) | 600 | 10 | TPD 500B |
| [`seedance-1-0-pro-250528`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro) | 600 | 10 | TPD 500B |

<span id="image-generation"></span><span id="9df4d9fd"></span>
## Image generation

Tutorials: [Image generation tutorial](/docs/image-generation-tutorial) | [Seedream 5.0 pro / flash tutorial](/docs/seedream-5-0-pro)
API documentation: [Generate images](/docs/image-generation-api)

<span id="image-generation-capabilities"></span>
### Capabilities

| Model ID | Layer decomposition | Single-image generation | Batch-image generation |
| --- | --- | --- | --- |
| [`dola-seedream-5-0-flash-260915`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seedream-5-0-flash) | Yes | * Text-to-image | Not supported | \
| | | * Single-reference image-to-image | | \
| | | * Multi-reference image-to-image | |
| [`dola-seedream-5-0-pro-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seedream-5-0-pro) | Yes | * Text-to-image | Not supported | \
| | | * Single-reference image-to-image | | \
| | | * Multi-reference image-to-image | |
| [`seedream-5-0-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-5-0) | No | * Text-to-image | * From text | \
| | | * Single-reference image-to-image | * From one reference image | \
| | | * Multi-reference image-to-image | * From multiple reference images | \
| Also supports `seedream-5-0-lite-260128` | | | |
| [`seedream-4-5-251128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-4-5) | No | * Text-to-image | * From text | \
| | | * Single-reference image-to-image | * From one reference image | \
| | | * Multi-reference image-to-image | * From multiple reference images |
| [`seedream-4-0-250828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-4-0) | No | * Text-to-image | * From text | \
| | | * Single-reference image-to-image | * From one reference image | \
| | | * Multi-reference image-to-image | * From multiple reference images |

<span id="image-generation-limits"></span>
### Limits

| Model ID | Max IPM |
| --- | --- |
| [`dola-seedream-5-0-flash-260915`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seedream-5-0-flash) | 500 |
| [`dola-seedream-5-0-pro-260628`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=dola-seedream-5-0-pro) | 500 |
| [`seedream-5-0-260128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-5-0) | 500 | \
| Also supports `seedream-5-0-lite-260128` | |
| [`seedream-4-5-251128`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-4-5) | 500 |
| [`seedream-4-0-250828`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedream-4-0) | 500 |

<span id="3d-generation"></span><span id="21b9a17a"></span>
## 3D generation

<span id="3d-generation-capabilities"></span>
### Capabilities

| Provider | Model ID | Input | Output types | File formats |
| --- | --- | --- | --- | --- |
| Deemos | [`hyper3d-gen2-260112`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=hyper3d-gen2) | Text | White model | `.glb` | \
| | | Images | Textured model | `.obj` | \
| | | | PBR material model | `.stl` | \
| | | | Textured PBR material model | `.fbx` | \
| | | | | `.usdz` |
| Hitem3D | [`hitem3d-2-0-251223`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=hitem3d-2-0) | Images | Standard white model | `.glb` | \
| | | | Standard textured model | `.obj` | \
| | | | High-precision white model | `.stl` | \
| | | | High-precision textured model | `.fbx` | \
| | | | | `.usdz` |

<span id="3d-generation-limits"></span>
### Limits

| Provider | Model ID | Output limits || Rate limits || Free quota |
| --- | --- | --- | --- | --- | --- | --- |
| | | Polygon count | Resolution | Max RPM | Max concurrency | |
| Deemos | [`hyper3d-gen2-260112`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=hyper3d-gen2) | Triangular mesh: 0.5K-1000K | Not supported | 0.06K | 3 | 150K | \
| | | Quad mesh: 1K-200K | | | | |
| Hitem3D | [`hitem3d-2-0-251223`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=hitem3d-2-0) | 100K-2000K | 1536 | 0.6K | 30 | 500K | \
| | | | 1536pro | | | |

<span id="embedding"></span><span id="0ee80bb9"></span>
## Embedding

Tutorials: [Multimodal embedding](/docs/vectorization)
API documentation: [Embeddings Multimodal API](/docs/multimodal-vectorization-api)

<span id="embedding-capabilities"></span>
### Capabilities

| Model ID | Input | Languages |
| --- | --- | --- |
| [`skylark-embedding-vision-251215`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=skylark-embedding-vision) | Video | Chinese | \
| | Image | English | \
| | Text | |

<span id="embedding-limits"></span>
### Limits

| Model ID | Context | Max vector dimension | Max RPM | Max TPM |
| --- | --- | --- | --- | --- |
| [`skylark-embedding-vision-251215`](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=skylark-embedding-vision) | 128K | 2048 | 1.2K | 1200K |
