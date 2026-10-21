# Export media preparation

Video export jobs prepare a disposable render copy before either Lambda or the other server renderers run. The saved composition, editable snapshot, source URLs, source trims, and original 4K uploads remain unchanged. GUI and CLI exports use the same job executor. Single-frame previews retain their existing cache path.

## Compatibility and fidelity

The worker reads metadata via HTTP Range first. HEVC and other non-H.264 codecs, non-8-bit H.264, high-bitrate sources (>50 Mbps), and 4K sources exceeding the composition fps receive a compatible H.264/yuv420p, CRF 18, short-GOP, faststart copy. Ordinary H.264 does not get recompressed just for having a higher fps than the composition. The copy retains the full source time axis, displayed dimensions (including rotation), and all audio streams (AAC 192 kbps). No downscale to the output/720p profile takes place. Odd source dimensions are padded by at most one pixel. Source fps is never increased.

Full source timing is deliberate: arbitrary generated JSX may reuse a source with different trims, loops, playback rates, or dynamic props. Rewriting a guessed interval would alter those semantics. Range-only preparation can be added later when all source usage is proven. Alpha and auxiliary-video sources pass through unchanged; H.264 cannot preserve alpha. HDR is explicitly tone-mapped into a BT.709 rendering copy instead of silently discarding transfer characteristics. This is a lossy compatibility encode; the original remains available.

Before accepting a rendition the worker checks codec, displayed dimensions, audio stream count and duration, then decodes the entire file. It never silently falls back to the problematic original after preparation fails.

## Runtime, cache, and recovery

- Use the existing `MEDIA_SANDBOX_SNAPSHOT_ID` and its FFmpeg/FFprobe packages. This does not modify or promote either shared snapshot. If absent, a fresh disposable Node VM installs the same pinned binary packages. Local media workers may execute the same preparation script locally.
- One VM per export, serial source preparation. Stream downloads and uploads directly through disk; do not buffer multi-hundred-MB videos in the app process. Each source/output is limited to 2 GiB with 512 MiB disk reserve, a four-minute source operation timeout, and a twelve-minute batch deadline. Jobs heartbeat every fifteen seconds during preparation. Worker exit is awaited independently of provider log streaming; cancellation terminates the command and stops the VM.
- Cache identity includes the owner, complete authorized URL, composition fps and encoding recipe. Do not strip access parameters for cache identity or expose URLs in progress/errors. Sources are expected to be immutable or versioned; changing a mutable URL's contents requires a new source URL or cache invalidation. Matching concurrent work in one process shares preparation.
- Renditions and manifests are private objects in the existing Remotion S3 bucket. The media VM receives only a short-lived, single-object upload URL. Render URLs are signed afresh for six hours; they are never saved into authored compositions. A manifest is committed only after upload succeeds, and cache hits verify object length. Compatible originals also cache the metadata decision.
- Cache entries live under `renders/7-days-media-<hash>/`, matching Remotion's existing seven-day lifecycle prefix. Application reuse stops after six days to leave a full day for active renders. Deployment owners should verify the bucket's seven-day lifecycle rule: application TTL is verified in code, physical deletion depends on the existing bucket rule. No bucket-wide policy is changed by this feature.
- Completed job metadata includes preparation summary and timings. Lambda IDs are persisted at submission so failed jobs retain a traceable render ID.

`REMOTION_EXPORT_PREPARE_MEDIA=false` disables preparation for rollback and changes the export fingerprint. Existing source snapshots do not require a database migration. Enabling this path requires the same Remotion S3 write/sign permissions and Sandbox OIDC context already used by the service; it adds no CLI parameter or package capability.

## Relationship to earlier fixes

`49d1e5bf` (2026-10-10) bounded raw-video frame reads and added streamed, reusable Sandbox media caching for `preview_frame`. `preparePreviewMedia()` was called from `renderDesignFrame()`, while final export still passed remote originals to Lambda. No codec normalization was performed there. The earlier investigation explicitly left final OffthreadVideo export failures outside that fix; selected successful exports did not establish compatibility for every large source.

`f243ddc5` (2026-10-09) upgraded Remotion to 4.0.527 and pinned the Lambda runtime to fix repeated horizontal rasterization strips. That visual corruption occurred even on a single frame. It is distinct from a high-bitrate HEVC source succeeding on one frame but failing during consecutive OffthreadVideo fetches.

The current regression starts from a rotated 3840×2160 HEVC/59.94fps/152Mbps source (481 MB), preserves the original 599-frame composition and runs its public export executor. A direct single-frame render succeeded while a twenty-frame render reproduced the internal proxy fetch error. Chrome's disk-space hint is generic; without disk telemetry/ENOSPC it must not be reported as confirmed disk exhaustion.
