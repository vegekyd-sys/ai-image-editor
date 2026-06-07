#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const APIFY_ACTOR = "apify/facebook-ads-scraper";
const APIFY_BASE_URL = "https://api.apify.com/v2";
const DONE_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const ASSET_FETCH_TIMEOUT_MS = 90000;

function parseArgs(argv) {
  const args = {
    activeStatus: "active",
    includeAboutPage: true,
    isDetailsPerAd: false,
    downloadAssets: true,
    outDir: "docs/meta-swipe-runs",
    pollMs: 5000,
    resultsLimit: 25,
    urls: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--url") {
      args.urls.push(next);
      i += 1;
    } else if (arg === "--urls-file") {
      args.urlsFile = next;
      i += 1;
    } else if (arg === "--input") {
      args.inputFile = next;
      i += 1;
    } else if (arg === "--out") {
      args.outDir = next;
      i += 1;
    } else if (arg === "--limit") {
      args.resultsLimit = Number(next);
      i += 1;
    } else if (arg === "--active-status") {
      args.activeStatus = next;
      i += 1;
    } else if (arg === "--details") {
      args.isDetailsPerAd = true;
    } else if (arg === "--no-about") {
      args.includeAboutPage = false;
    } else if (arg === "--download-assets") {
      args.downloadAssets = true;
    } else if (arg === "--no-download-assets") {
      args.downloadAssets = false;
    } else if (arg === "--poll-ms") {
      args.pollMs = Number(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function showHelp() {
  console.log(`Usage:
  APIFY_TOKEN=... node scripts/meta-swipe-apify.mjs --url <META_AD_LIBRARY_OR_PAGE_URL> [--limit 25]
  node scripts/meta-swipe-apify.mjs --urls-file docs/meta-swipe-runs/seed-urls.txt --limit 15
  node scripts/meta-swipe-apify.mjs --input docs/meta-swipe-runs/apify-input.example.json

Options:
  --url <url>             Meta Ad Library URL or Facebook Page URL. Repeatable.
  --urls-file <path>      File with one URL per line. Lines starting with # are ignored.
  --input <path>          Full Apify actor input JSON. Overrides URL flags.
  --limit <number>        Maximum ads per run. Default: 25.
  --active-status <value> active | inactive | empty string. Default: active.
  --details               Scrape extra per-ad details. Slower and may cost more.
  --no-about              Skip page transparency/about information.
  --download-assets       Download first video/image for each ad immediately. Default: on.
  --no-download-assets    Keep only remote asset URLs. Not recommended for fbcdn video links.
  --out <dir>             Output directory. Default: docs/meta-swipe-runs.
`);
}

async function loadDotenvLocal() {
  const envPath = path.resolve(".env.local");
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function readUrlsFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function buildInput(args) {
  if (args.inputFile) {
    return JSON.parse(await fs.readFile(args.inputFile, "utf8"));
  }

  const urls = [...args.urls];
  if (args.urlsFile) urls.push(...(await readUrlsFile(args.urlsFile)));
  if (urls.length === 0) {
    throw new Error("Provide at least one --url, --urls-file, or --input JSON file.");
  }

  return {
    startUrls: urls.map((url) => ({ url })),
    resultsLimit: args.resultsLimit,
    includeAboutPage: args.includeAboutPage,
    isDetailsPerAd: args.isDetailsPerAd,
    activeStatus: args.activeStatus,
  };
}

async function apifyFetch(pathname, { method = "GET", token, body } = {}) {
  const url = new URL(`${APIFY_BASE_URL}${pathname}`);
  url.searchParams.set("token", token);

  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = json?.error?.message || response.statusText;
    throw new Error(`Apify API error ${response.status}: ${message}`);
  }
  return json;
}

async function startRun(token, input) {
  const result = await apifyFetch(`/acts/${APIFY_ACTOR.replace("/", "~")}/runs`, {
    method: "POST",
    token,
    body: input,
  });
  return result.data;
}

async function waitForRun(token, runId, pollMs) {
  while (true) {
    const result = await apifyFetch(`/actor-runs/${runId}`, { token });
    const run = result.data;
    const status = run.status;
    console.log(`Apify run ${runId}: ${status}`);
    if (DONE_STATUSES.has(status)) return run;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function fetchDatasetItems(token, datasetId) {
  const url = new URL(`${APIFY_BASE_URL}/datasets/${datasetId}/items`);
  url.searchParams.set("token", token);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify dataset error ${response.status}: ${text}`);
  }
  return JSON.parse(text || "[]");
}

function firstText(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value?.text === "string" && value.text.trim()) return value.text.trim();
  }
  return "";
}

function compactArray(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractCreatives(item) {
  const snapshot = item.snapshot || item.ad || item.creative || {};
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const cardTexts = cards.flatMap((card) => [
    card.body,
    card.title,
    card.linkDescription,
    card.caption,
  ]);
  const images = [
    ...(Array.isArray(snapshot.images) ? snapshot.images : []),
    ...(Array.isArray(snapshot.extraImages) ? snapshot.extraImages : []),
    ...cards.map((card) => card.originalImageUrl || card.resizedImageUrl),
    snapshot.originalImageUrl,
    snapshot.resizedImageUrl,
  ];
  const videos = [
    ...(Array.isArray(snapshot.videos) ? snapshot.videos : []),
    ...(Array.isArray(snapshot.extraVideos) ? snapshot.extraVideos : []),
    ...cards.map((card) => card.videoHdUrl || card.videoSdUrl || card.videoPreviewImageUrl),
    snapshot.videoHdUrl,
    snapshot.videoSdUrl,
    snapshot.videoPreviewImageUrl,
  ];

  return {
    text: firstText(snapshot.body, item.body, item.text, ...cardTexts, snapshot.caption),
    title: firstText(snapshot.title, ...cards.map((card) => card.title), item.title),
    description: firstText(snapshot.linkDescription, ...cards.map((card) => card.linkDescription), item.linkDescription),
    cta: firstText(snapshot.ctaText, ...cards.map((card) => card.ctaText || card.ctaType), snapshot.ctaType, item.ctaText, item.ctaType),
    linkUrl: firstText(snapshot.linkUrl, ...cards.map((card) => card.linkUrl), item.linkUrl),
    imageUrls: compactArray(images.map((value) => (typeof value === "string" ? value : value?.url))),
    videoUrls: compactArray(videos.map((value) => (
      typeof value === "string"
        ? value
        : value?.videoHdUrl || value?.videoSdUrl || value?.watermarkedVideoHdUrl || value?.watermarkedVideoSdUrl || value?.url
    ))),
    cardCount: cards.length,
  };
}

function inferMakaronAngle(record) {
  const haystack = [
    record.text,
    record.title,
    record.description,
    record.linkUrl,
    record.pageName,
  ]
    .join(" ")
    .toLowerCase();

  if (/video|vlog|reel|motion|animate|capcut/.test(haystack)) return "Photo to Vlog";
  if (/avatar|selfie|portrait|headshot|profile/.test(haystack)) return "Idol Selfie / Profile Pic";
  if (/poster|fan|album|idol|kpop|k-pop/.test(haystack)) return "Idol Poster / Fan Visual";
  if (/pet|dog|cat/.test(haystack)) return "Pet Cover";
  if (/photo.?booth|polaroid|film|camera|retro|ccd/.test(haystack)) return "Photo Booth / CCD";
  if (/bling|diamond|night|club|flash/.test(haystack)) return "Night Flash / Bling";
  return "General AI Photo Edit";
}

function normalizeItem(item, index) {
  const creative = extractCreatives(item);
  const record = {
    index: index + 1,
    adArchiveId: item.adArchiveId || item.archiveId || item.id || item.adId || "",
    pageName: item.pageName || item.pageInfo?.page?.name || "",
    pageId: item.pageId || item.pageInfo?.page?.id || "",
    isActive: item.isActive,
    platforms: item.publisherPlatform || item.publisherPlatforms || [],
    startDate: item.startDateFormatted || item.startDate || "",
    endDate: item.endDateFormatted || item.endDate || "",
    snapshotUrl: item.snapshotUrl || item.adSnapshotUrl || item.url || "",
    inputUrl: item.inputUrl || "",
    ...creative,
  };
  return {
    ...record,
    mediaType: record.videoUrls.length > 0 ? "video" : record.imageUrls.length > 0 ? "image" : "unknown",
    makaronAngle: inferMakaronAngle(record),
  };
}

function markdownEscape(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function safeSlug(text) {
  return String(text || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";
}

function extFromContentType(contentType = "", fallback = ".bin") {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm") return ".webm";
  if (type === "video/quicktime") return ".mov";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  return fallback;
}

function extFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    return ext || fallback;
  } catch {
    return fallback;
  }
}

async function downloadAsset(url, filePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 MetaAdSwipeArchiver/1.0",
        accept: "*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());
    const finalPath = filePath.replace(/\.bin$/, extFromContentType(contentType, ".bin"));
    await fs.writeFile(finalPath, buffer);
    return finalPath;
  } finally {
    clearTimeout(timer);
  }
}

async function archiveAssets(records, outDir, stamp) {
  const assetsDir = path.join(outDir, `${stamp}-assets`);
  await fs.mkdir(assetsDir, { recursive: true });

  for (const record of records) {
    const slug = safeSlug(`${record.index}-${record.pageName || record.adArchiveId || "ad"}`);
    record.localVideoPaths = [];
    record.localImagePaths = [];
    record.assetDownloadErrors = [];

    const videoUrl = record.videoUrls[0];
    if (videoUrl) {
      const fallbackExt = extFromUrl(videoUrl, ".mp4");
      const target = path.join(assetsDir, `${slug}-video${fallbackExt || ".mp4"}`);
      try {
        console.log(`Downloading video asset for #${record.index}: ${record.pageName || record.adArchiveId}`);
        const saved = await downloadAsset(videoUrl, target);
        record.localVideoPaths.push(saved);
      } catch (error) {
        record.assetDownloadErrors.push({ type: "video", url: videoUrl, error: error.message });
        console.warn(`Could not download video for #${record.index}: ${error.message}`);
      }
    }

    const imageUrl = record.imageUrls[0];
    if (imageUrl) {
      const fallbackExt = extFromUrl(imageUrl, ".jpg");
      const target = path.join(assetsDir, `${slug}-image${fallbackExt || ".jpg"}`);
      try {
        console.log(`Downloading image asset for #${record.index}: ${record.pageName || record.adArchiveId}`);
        const saved = await downloadAsset(imageUrl, target);
        record.localImagePaths.push(saved);
      } catch (error) {
        record.assetDownloadErrors.push({ type: "image", url: imageUrl, error: error.message });
        console.warn(`Could not download image for #${record.index}: ${error.message}`);
      }
    }
  }
}

function buildMarkdown(records, run, input) {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Meta Creative Swipe Run",
    "",
    `Generated: ${generatedAt}`,
    `Apify actor: ${APIFY_ACTOR}`,
    `Run ID: ${run.id}`,
    `Status: ${run.status}`,
    `Dataset ID: ${run.defaultDatasetId}`,
    `Requested limit: ${input.resultsLimit ?? "not set"}`,
    "",
    "## Source URLs",
    "",
    ...input.startUrls.map((entry) => `- ${entry.url}`),
    "",
    "## Swipe Table",
    "",
    "| # | Brand | Type | Hook / Body | CTA | Platforms | Makaron angle | Assets |",
    "|---|---|---|---|---|---|---|---|",
  ];

  for (const record of records) {
    const assets = [
      record.localVideoPaths?.[0] ? `[video-local](${record.localVideoPaths[0]})` : "",
      record.localImagePaths?.[0] ? `[image-local](${record.localImagePaths[0]})` : "",
      record.videoUrls[0] ? `[video-remote](${record.videoUrls[0]})` : "",
      record.imageUrls[0] ? `[image-remote](${record.imageUrls[0]})` : "",
      record.snapshotUrl ? `[snapshot](${record.snapshotUrl})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `| ${record.index} | ${markdownEscape(record.pageName)} | ${record.mediaType} | ${markdownEscape(record.text || record.title).slice(0, 220)} | ${markdownEscape(record.cta)} | ${markdownEscape((record.platforms || []).join(", "))} | ${markdownEscape(record.makaronAngle)} | ${assets} |`,
    );
  }

  lines.push(
    "",
    "## Makaron Remake Notes",
    "",
    "- Do not copy competitor assets. Extract the pattern: first-frame reveal, hook wording, transition rhythm, CTA shape.",
    "- Prioritize 9:16 video concepts where the first 2 seconds show the after-result.",
    "- Map each winning pattern to one Makaron skill page and one concrete user input.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    showHelp();
    return;
  }

  await loadDotenvLocal();
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("Missing APIFY_TOKEN. Add it to .env.local or export it for this command.");
  }

  const input = await buildInput(args);
  await fs.mkdir(args.outDir, { recursive: true });

  console.log(`Starting ${APIFY_ACTOR} with ${input.startUrls?.length || "custom"} source(s)...`);
  const run = await startRun(token, input);
  const finishedRun = await waitForRun(token, run.id, args.pollMs);

  if (finishedRun.status !== "SUCCEEDED") {
    throw new Error(`Apify run ended with ${finishedRun.status}. Check run ${finishedRun.id} in Apify Console.`);
  }

  const items = await fetchDatasetItems(token, finishedRun.defaultDatasetId);
  const records = items.map(normalizeItem);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = path.join(args.outDir, `${stamp}-raw.json`);
  const normalizedPath = path.join(args.outDir, `${stamp}-normalized.json`);
  const markdownPath = path.join(args.outDir, `${stamp}-swipe.md`);

  if (args.downloadAssets) {
    await archiveAssets(records, args.outDir, stamp);
  }

  await fs.writeFile(rawPath, `${JSON.stringify(items, null, 2)}\n`);
  await fs.writeFile(normalizedPath, `${JSON.stringify(records, null, 2)}\n`);
  await fs.writeFile(markdownPath, buildMarkdown(records, finishedRun, input));

  console.log(`Saved ${items.length} raw item(s): ${rawPath}`);
  console.log(`Saved ${records.length} normalized record(s): ${normalizedPath}`);
  console.log(`Saved swipe markdown: ${markdownPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
