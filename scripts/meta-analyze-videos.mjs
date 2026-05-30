#!/usr/bin/env node

import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const OUT_DIR = "docs/meta-skill-research/video-analysis";

function parseArgs(argv) {
  const args = {
    adJson: "",
    internal: false,
    limit: 6,
    model: DEFAULT_MODEL,
    outDir: OUT_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--ad-json") {
      args.adJson = next;
      i += 1;
    } else if (arg === "--internal") {
      args.internal = true;
    } else if (arg === "--limit") {
      args.limit = Number(next);
      i += 1;
    } else if (arg === "--model") {
      args.model = next;
      i += 1;
    } else if (arg === "--out") {
      args.outDir = next;
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
  node scripts/meta-analyze-videos.mjs --ad-json docs/meta-swipe-runs/<run>-normalized.json --limit 8
  node scripts/meta-analyze-videos.mjs --internal --limit 10
`);
}

async function loadDotenvLocal() {
  try {
    const text = await fs.readFile(".env.local", "utf8");
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

function isVideoUrl(url = "") {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

function stripUrl(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function getMimeType(filePath = "") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

async function waitForUploadedFile(ai, uploadResult) {
  let file = uploadResult;
  while (file.state === "PROCESSING") {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    file = await ai.files.get({ name: file.name });
    process.stdout.write(".");
  }
  if (file.state !== "ACTIVE") {
    throw new Error(`Gemini file processing failed: ${file.state}`);
  }
  return file;
}

function getPrompt(kind, item) {
  const context = kind === "ad"
    ? `This is a paid Meta ad creative from ${item.pageName || "unknown advertiser"}.
Ad copy: ${item.text || ""}
CTA: ${item.cta || ""}
Landing URL: ${item.linkUrl || ""}`
    : `This is a Makaron marketplace skill cover for ${item.name}.
Skill prompt: ${item.prompt || ""}`;

  return `${context}

Analyze this video for paid-social creative strategy. Return STRICT JSON only:
{
  "one_line_summary": "...",
  "target_viewer": "...",
  "first_2_seconds": "...",
  "shot_breakdown": [
    {"time": "0-2s", "visual": "...", "motion": "...", "text_or_ui": "...", "why_it_hooks": "..."}
  ],
  "creative_mechanic": "before_after | template_reveal | tutorial | ugc_reaction | fantasy_scene | character_action | montage | other",
  "visual_style": ["..."],
  "hook_strength_1_to_10": 0,
  "clarity_1_to_10": 0,
  "makaron_relevance_1_to_10": 0,
  "best_makaron_skill_match": "...",
  "what_to_copy_as_pattern_not_asset": "...",
  "what_to_change_for_makaron": "...",
  "recommended_ad_hook": "...",
  "recommended_first_2s_remake": "..."
}`;
}

async function analyzeVideo(ai, item, kind, model) {
  let fileUri = item.videoUrl;
  let mimeType = "video/mp4";
  if (item.localVideoPath) {
    console.log(`Uploading local video archive: ${item.localVideoPath}`);
    const uploadResult = await ai.files.upload({
      file: item.localVideoPath,
      config: { mimeType: getMimeType(item.localVideoPath) },
    });
    const file = await waitForUploadedFile(ai, uploadResult);
    console.log(` ${file.state}`);
    fileUri = file.uri;
    mimeType = file.mimeType || getMimeType(item.localVideoPath);
  }
  const prompt = getPrompt(kind, item);
  const response = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { fileData: { fileUri, mimeType } },
        { text: prompt },
      ],
    }],
    config: { temperature: 0.2 },
  });
  const text = response.text || "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : text.trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return { parse_error: true, raw: text };
  }
}

async function loadAdItems(filePath, limit) {
  const records = JSON.parse(await fs.readFile(filePath, "utf8"));
  const preferred = [
    /glam/i,
    /remini/i,
    /hypic/i,
    /videoexpress/i,
    /fotopro/i,
    /vidix/i,
    /sola/i,
    /captions/i,
    /mojo/i,
    /onbeat/i,
  ];
  const seen = new Set();
  return records
    .filter((item) => Array.isArray(item.videoUrls) && item.videoUrls.length > 0)
    .map((item) => ({
      id: String(item.adArchiveId || item.index),
      pageName: item.pageName,
      text: item.text,
      cta: item.cta,
      linkUrl: item.linkUrl,
      inputUrl: item.inputUrl,
      videoUrl: item.videoUrls[0],
      localVideoPath: item.localVideoPaths?.[0] || "",
      priority: preferred.findIndex((pattern) => pattern.test(`${item.pageName} ${item.text}`)),
    }))
    .filter((item) => {
      const key = `${item.pageName}|${item.text}|${stripUrl(item.videoUrl)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ap = a.priority === -1 ? 99 : a.priority;
      const bp = b.priority === -1 ? 99 : b.priority;
      return ap - bp;
    })
    .slice(0, limit);
}

async function loadInternalItems(limit) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for internal skill analysis.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("home_skills")
    .select("id,labels,image,prompt,skill_path,image_count,sort_order,is_active,before_images")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const priorityNames = [
    /photo to video/i,
    /fun vlog/i,
    /broadcast candid/i,
    /one-take/i,
    /character select/i,
    /pet mugshot/i,
    /pet action movie/i,
    /map tap transition/i,
    /seamless.*transition/i,
    /corridor breakout/i,
    /funny face/i,
  ];

  return data
    .filter((skill) => isVideoUrl(skill.image))
    .map((skill) => {
      const name = skill.labels?.en || skill.labels?.zh || skill.id;
      return {
        id: skill.id,
        name,
        prompt: skill.prompt,
        videoUrl: skill.image,
        inputCount: skill.image_count,
        beforeCount: Array.isArray(skill.before_images) ? skill.before_images.length : 0,
        sortOrder: skill.sort_order,
        priority: priorityNames.findIndex((pattern) => pattern.test(name)),
      };
    })
    .sort((a, b) => {
      const ap = a.priority === -1 ? 99 : a.priority;
      const bp = b.priority === -1 ? 99 : b.priority;
      if (ap !== bp) return ap - bp;
      return a.sortOrder - b.sortOrder;
    })
    .slice(0, limit);
}

function renderMarkdown(kind, rows) {
  const lines = [
    `# ${kind === "ad" ? "Meta Ad Video Analysis" : "Makaron Skill Cover Video Analysis"}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| # | Source | Hook score | Clarity | Makaron relevance | Best match | Recommended hook | Change needed |",
    "|---:|---|---:|---:|---:|---|---|---|",
  ];
  rows.forEach((row, index) => {
    const a = row.analysis || {};
    const source = row.kind === "ad" ? row.item.pageName : row.item.name;
    lines.push(`| ${index + 1} | ${String(source || "").replace(/\|/g, "/")} | ${a.hook_strength_1_to_10 ?? ""} | ${a.clarity_1_to_10 ?? ""} | ${a.makaron_relevance_1_to_10 ?? ""} | ${String(a.best_makaron_skill_match || "").replace(/\|/g, "/")} | ${String(a.recommended_ad_hook || "").replace(/\|/g, "/")} | ${String(a.what_to_change_for_makaron || "").replace(/\|/g, "/").slice(0, 220)} |`);
  });
  lines.push("", "## Detailed Notes", "");
  rows.forEach((row, index) => {
    const a = row.analysis || {};
    const source = row.kind === "ad" ? row.item.pageName : row.item.name;
    lines.push(`### ${index + 1}. ${source || row.item.id}`, "");
    lines.push(`Video: ${row.item.localVideoPath || stripUrl(row.item.videoUrl)}`, "");
    lines.push(`Summary: ${a.one_line_summary || ""}`, "");
    lines.push(`First 2s: ${a.first_2_seconds || ""}`, "");
    lines.push(`Pattern: ${a.what_to_copy_as_pattern_not_asset || ""}`, "");
    lines.push(`Remake: ${a.recommended_first_2s_remake || ""}`, "");
  });
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    showHelp();
    return;
  }
  await loadDotenvLocal();
  if (!process.env.GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY.");

  const kind = args.internal ? "internal" : "ad";
  if (!args.internal && !args.adJson) throw new Error("Provide --ad-json or --internal.");

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const items = args.internal
    ? await loadInternalItems(args.limit)
    : await loadAdItems(args.adJson, args.limit);

  await fs.mkdir(args.outDir, { recursive: true });
  const rows = [];
  for (const item of items) {
    console.log(`Analyzing ${kind}: ${item.pageName || item.name || item.id}`);
    const analysis = await analyzeVideo(ai, item, kind === "internal" ? "internal" : "ad", args.model);
    rows.push({ kind, item, analysis });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outDir, `${stamp}-${kind}-video-analysis.json`);
  const mdPath = path.join(args.outDir, `${stamp}-${kind}-video-analysis.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
  await fs.writeFile(mdPath, renderMarkdown(kind, rows));
  console.log(`Saved: ${jsonPath}`);
  console.log(`Saved: ${mdPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
