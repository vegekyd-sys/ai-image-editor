import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { MediaInputFile, MediaItem } from './media-sandbox'

const SANDBOX_ROOT = '/vercel/sandbox'
const SANDBOX_INPUT_DIR = `${SANDBOX_ROOT}/agent-inputs`
const SANDBOX_OUTPUT_DIR = `${SANDBOX_ROOT}/agent-outputs`
const SANDBOX_WORK_DIR = `${SANDBOX_ROOT}/agent-work`
const SANDBOX_RESULT_PATH = `${SANDBOX_ROOT}/agent-result.json`

export interface VercelMediaSandboxOptions {
  code: string
  compiledCode: string
  codePath?: string
  description?: string
  inputFiles: MediaInputFile[]
  mediaItems: MediaItem[]
  mediaRefs: number[]
  workspacePaths: string[]
  localOutputDir: string
  projectId: string
  userId: string
  timeoutMs: number
}

interface SandboxOutputManifest {
  path: string
  relativePath: string
}

interface SandboxExecutionManifest {
  result: unknown
  outputs: SandboxOutputManifest[]
}

export class VercelMediaSandboxExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VercelMediaSandboxExecutionError'
  }
}

export function shouldUseVercelMediaSandbox(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = env.MEDIA_SANDBOX_EXECUTOR?.trim().toLowerCase()
  if (configured === 'local') return false
  if (configured === 'vercel') return true
  return Boolean(
    env.MEDIA_SANDBOX_SNAPSHOT_ID
    || env.VERCEL_OIDC_TOKEN
    || env.VERCEL,
  )
}

function safeFileName(name: string, fallback: string): string {
  const cleaned = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-')
  return cleaned || fallback
}

function rewriteSandboxPaths(value: unknown, pathMap: Map<string, string>): unknown {
  if (typeof value === 'string') return pathMap.get(value) || value
  if (Array.isArray(value)) return value.map(item => rewriteSandboxPaths(item, pathMap))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, rewriteSandboxPaths(item, pathMap)]),
  )
}

// This runner intentionally exposes normal Node inside the disposable Sandbox.
// Protection comes from the VM boundary, not from changing Node APIs or
// maintaining a package whitelist. Bare packages are installed on first use so
// an Agent can use the npm ecosystem without rewriting working code for Makaron.
export const MEDIA_SANDBOX_RUNNER_SOURCE = String.raw`
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {createRequire} = require('module');
const {execFile, execFileSync} = require('child_process');
const {promisify} = require('util');

const ROOT = '/vercel/sandbox';
const INPUT_DIR = path.join(ROOT, 'agent-inputs');
const OUTPUT_DIR = path.join(ROOT, 'agent-outputs');
const WORK_DIR = path.join(ROOT, 'agent-work');
const RESULT_PATH = path.join(ROOT, 'agent-result.json');
const SOURCE_PATH = path.join(WORK_DIR, 'agent-source.json');
const CONFIG_PATH = path.join(WORK_DIR, 'agent-context.json');
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const entryFile = path.join(WORK_DIR, source.fileName || 'agent-media-code.js');
const entryRequire = createRequire(entryFile);
const installed = new Set();

function packageName(id) {
  if (!id || id.startsWith('.') || id.startsWith('/') || id.startsWith('node:')) return null;
  if (id.startsWith('@')) return id.split('/').slice(0, 2).join('/');
  return id.split('/')[0];
}

function installPackage(id) {
  const name = packageName(id);
  if (!name || installed.has(name)) return;
  installed.add(name);
  console.error('[media-sandbox] installing missing package ' + name);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', name], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    timeout: 120000,
  });
}

function openRequire(id) {
  try {
    return entryRequire(id);
  } catch (error) {
    if (!error || error.code !== 'MODULE_NOT_FOUND' || !packageName(id)) throw error;
    installPackage(id);
    return entryRequire(id);
  }
}

async function findFfmpeg() {
  try {
    return String(openRequire('ffmpeg-static'));
  } catch {}
  try {
    return execFileSync('which', ['ffmpeg'], {encoding: 'utf8'}).trim();
  } catch {}
  installPackage('ffmpeg-static');
  return String(openRequire('ffmpeg-static'));
}

function findFfprobe() {
  try {
    const pkg = openRequire('ffprobe-static');
    if (pkg && typeof pkg.path === 'string') return pkg.path;
  } catch {}
  try {
    return execFileSync('which', ['ffprobe'], {encoding: 'utf8'}).trim();
  } catch {
    return '';
  }
}

function parseDuration(stderr) {
  const match = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

async function probeVideo(filePath) {
  const ffprobePath = findFfprobe();
  if (ffprobePath) {
    const {stdout} = await promisify(execFile)(ffprobePath, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ], {maxBuffer: 12 * 1024 * 1024});
    const parsed = JSON.parse(stdout);
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video');
    const audio = streams.find(stream => stream.codec_type === 'audio');
    const duration = Number(parsed.format && parsed.format.duration || video && video.duration);
    return {
      duration: Number.isFinite(duration) ? duration : null,
      width: video && video.width,
      height: video && video.height,
      codec: video && video.codec_name,
      audioCodec: audio && audio.codec_name,
      format: parsed.format,
      streams,
    };
  }

  const ffmpegPath = await findFfmpeg();
  try {
    await promisify(execFile)(ffmpegPath, ['-i', filePath, '-f', 'null', '-'], {
      maxBuffer: 12 * 1024 * 1024,
    });
    return {duration: null};
  } catch (error) {
    const stderr = error && error.stderr || '';
    const size = String(stderr).match(/Video:.*?,\s*(\d+)x(\d+)[,\s]/);
    return {
      duration: parseDuration(stderr),
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
    };
  }
}

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed (' + response.status + '): ' + url);
  const body = Buffer.from(await response.arrayBuffer());
  await fsp.mkdir(path.dirname(filePath), {recursive: true});
  await fsp.writeFile(filePath, body);
  return {
    filePath,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    size: body.length,
  };
}

const requestedOutputs = [];

function outputTarget(localPath) {
  const resolved = path.resolve(localPath);
  if (resolved === OUTPUT_DIR || resolved.startsWith(OUTPUT_DIR + path.sep)) return resolved;
  return path.join(OUTPUT_DIR, path.basename(resolved));
}

async function saveOutput(localPath, workspacePath, contentType) {
  const sourcePath = path.resolve(localPath);
  const targetPath = outputTarget(sourcePath);
  await fsp.mkdir(path.dirname(targetPath), {recursive: true});
  if (sourcePath !== targetPath) await fsp.copyFile(sourcePath, targetPath);
  const output = {path: targetPath, workspacePath, contentType};
  requestedOutputs.push(output);
  return {success: true, ...output};
}

async function saveToWorkspace(workspacePath, content, contentType) {
  const target = path.join(OUTPUT_DIR, path.basename(workspacePath));
  await fsp.mkdir(path.dirname(target), {recursive: true});
  await fsp.writeFile(target, Buffer.isBuffer(content) ? content : String(content));
  const output = {path: target, workspacePath, contentType};
  requestedOutputs.push(output);
  return {success: true, ...output};
}

function resultOutputs(result) {
  const values = [];
  if (result && typeof result === 'object') {
    if (typeof result.path === 'string') values.push(result);
    if (Array.isArray(result.outputs)) values.push(...result.outputs);
  }
  values.push(...requestedOutputs);
  return values.filter(item => item && typeof item.path === 'string');
}

async function materializeOutputs(result) {
  const seen = new Set();
  for (const output of resultOutputs(result)) {
    const sourcePath = path.resolve(output.path);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = outputTarget(sourcePath);
    await fsp.mkdir(path.dirname(targetPath), {recursive: true});
    if (targetPath !== sourcePath) await fsp.copyFile(sourcePath, targetPath);
    output.path = targetPath;
    seen.add(targetPath);
  }

  async function walk(directory) {
    const entries = await fsp.readdir(directory, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else seen.add(fullPath);
    }
  }
  await walk(OUTPUT_DIR);
  return [...seen].map(filePath => ({
    path: filePath,
    relativePath: path.relative(OUTPUT_DIR, filePath),
  }));
}

async function main() {
  await fsp.mkdir(INPUT_DIR, {recursive: true});
  await fsp.mkdir(OUTPUT_DIR, {recursive: true});
  await fsp.mkdir(WORK_DIR, {recursive: true});
  if (!fs.existsSync(entryFile)) await fsp.writeFile(entryFile, source.originalCode || '');

  const ffmpegPath = await findFfmpeg();
  const ffprobePath = findFfprobe();
  const context = {
    ...config,
    inputFiles: config.inputFiles,
    paths: {workDir: WORK_DIR, inputDir: INPUT_DIR, outputDir: OUTPUT_DIR, workspaceDir: WORK_DIR},
    workspaceDir: WORK_DIR,
    ffmpegPath,
    ffprobePath,
  };
  const moduleState = {exports: {}};
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const runner = new AsyncFunction(
    'require', 'process', 'console', 'fetch', 'ctx', 'context', 'inputFiles',
    'outputDir', 'inputDir', 'workDir', 'workspaceDir', 'ffmpegPath', 'ffprobePath',
    'downloadFile', 'saveToWorkspace', 'saveOutput', 'probeVideo', '__filename',
    '__dirname', 'module', 'exports', source.compiledCode,
  );

  let result = await runner(
    openRequire, process, console, fetch, context, context, context.inputFiles,
    OUTPUT_DIR, INPUT_DIR, WORK_DIR, WORK_DIR, ffmpegPath, ffprobePath,
    downloadFile, saveToWorkspace, saveOutput, probeVideo, entryFile,
    path.dirname(entryFile), moduleState, moduleState.exports,
  );

  if (result === undefined) {
    const exported = moduleState.exports;
    const entry = exported && (exported.default ?? exported.main ?? exported.run ?? exported.handler);
    if (typeof entry === 'function') {
      result = await entry({
        require: openRequire, process, console, fetch, ctx: context, context,
        inputFiles: context.inputFiles, outputDir: OUTPUT_DIR, inputDir: INPUT_DIR,
        workDir: WORK_DIR, workspaceDir: WORK_DIR, ffmpegPath, ffprobePath,
        downloadFile, saveToWorkspace, saveOutput, probeVideo,
      });
    } else if (entry !== undefined) {
      result = entry;
    } else if (exported && (typeof exported !== 'object' || Object.keys(exported).length > 0)) {
      result = exported;
    }
  }

  const outputs = await materializeOutputs(result);
  await fsp.writeFile(RESULT_PATH, JSON.stringify({result, outputs}));
}

main().catch(async error => {
  const message = error && error.stack || String(error);
  await fsp.writeFile(RESULT_PATH, JSON.stringify({error: message, result: null, outputs: []})).catch(() => {});
  console.error(message);
  process.exitCode = 1;
});
`

export async function runNodeMediaCodeInVercelSandbox(
  options: VercelMediaSandboxOptions,
): Promise<{ result: unknown; sandboxId: string }> {
  const { Sandbox } = await import('@vercel/sandbox')
  const snapshotId = process.env.MEDIA_SANDBOX_SNAPSHOT_ID
  const createOptions = {
    ...(snapshotId
      ? { source: { type: 'snapshot' as const, snapshotId } }
      : { runtime: 'node24' }),
    resources: { vcpus: Math.max(1, Math.min(8, Number(process.env.MEDIA_SANDBOX_VCPUS || 4))) },
    timeout: Math.max(60_000, Math.min(5 * 60_000, options.timeoutMs + 60_000)),
  }
  const sandbox = await Sandbox.create(createOptions)

  try {
    await sandbox.mkDir(SANDBOX_INPUT_DIR)
    await sandbox.mkDir(SANDBOX_OUTPUT_DIR)
    await sandbox.mkDir(SANDBOX_WORK_DIR)

    const remoteInputs = options.inputFiles.map((input, index) => ({
      ...input,
      inputPath: `${SANDBOX_INPUT_DIR}/${String(index + 1).padStart(2, '0')}-${safeFileName(input.fileName, `input-${index + 1}`)}`,
    }))
    const sourceFileName = safeFileName(options.codePath || 'agent-media-code.tsx', 'agent-media-code.tsx')
    const context = {
      projectId: options.projectId,
      userId: options.userId,
      description: options.description || '',
      media: options.mediaItems,
      mediaRefs: options.mediaRefs,
      workspacePaths: options.workspacePaths,
      inputFiles: remoteInputs,
    }

    await sandbox.writeFiles([
      ...await Promise.all(options.inputFiles.map(async (input, index) => ({
        path: remoteInputs[index].inputPath,
        content: await readFile(input.inputPath),
      }))),
      {
        path: `${SANDBOX_WORK_DIR}/agent-source.json`,
        content: JSON.stringify({
          originalCode: options.code,
          compiledCode: options.compiledCode,
          fileName: sourceFileName,
        }),
      },
      {
        path: `${SANDBOX_WORK_DIR}/agent-context.json`,
        content: JSON.stringify(context),
      },
      {
        path: `${SANDBOX_WORK_DIR}/${sourceFileName}`,
        content: options.code,
      },
      {
        path: `${SANDBOX_ROOT}/media-sandbox-runner.cjs`,
        content: MEDIA_SANDBOX_RUNNER_SOURCE,
      },
    ])

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    let command
    try {
      try {
        command = await sandbox.runCommand({
          cmd: 'node',
          args: ['media-sandbox-runner.cjs'],
          cwd: SANDBOX_ROOT,
          env: {
            HOME: SANDBOX_ROOT,
            LANG: 'C.UTF-8',
            LC_ALL: 'C.UTF-8',
            NODE_ENV: 'production',
            NPM_CONFIG_CACHE: `${SANDBOX_ROOT}/.npm`,
            PATH: '/vercel/sandbox/bin:/vercel/sandbox/node_modules/.bin:/vercel/runtimes/node24/bin:/usr/local/bin:/usr/bin:/bin',
            TZ: process.env.TZ || 'UTC',
          },
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new VercelMediaSandboxExecutionError(`Agent code timed out after ${options.timeoutMs}ms in Vercel Sandbox`)
        }
        throw error
      }
    } finally {
      clearTimeout(timer)
    }

    const manifestBuffer = await sandbox.readFileToBuffer({ path: SANDBOX_RESULT_PATH })
    const stderr = await command.stderr().catch(() => '')
    if (!manifestBuffer) {
      throw new VercelMediaSandboxExecutionError(
        `Vercel media Sandbox did not produce a result (exit ${command.exitCode}): ${stderr.slice(-8000)}`,
      )
    }
    const manifest = JSON.parse(manifestBuffer.toString('utf8')) as SandboxExecutionManifest & { error?: string }
    if (command.exitCode !== 0 || manifest.error) {
      const executionError = manifest.error || `Vercel media Sandbox exited ${command.exitCode}`
      const processOutput = stderr.trim()
      throw new VercelMediaSandboxExecutionError(
        processOutput && !executionError.includes(processOutput)
          ? `${executionError}\n\nSandbox process stderr:\n${processOutput.slice(-8000)}`
          : executionError,
      )
    }

    const pathMap = new Map<string, string>()
    for (const output of manifest.outputs) {
      const relativePath = output.relativePath
        .split(/[\\/]+/)
        .filter(part => part && part !== '.' && part !== '..')
        .join(path.sep)
      const localPath = path.join(options.localOutputDir, relativePath || safeFileName(output.path, 'output.bin'))
      const body = await sandbox.readFileToBuffer({ path: output.path })
      if (!body) continue
      await mkdir(path.dirname(localPath), { recursive: true })
      await writeFile(localPath, body)
      pathMap.set(output.path, localPath)
    }

    return {
      result: rewriteSandboxPaths(manifest.result, pathMap),
      sandboxId: sandbox.sandboxId,
    }
  } finally {
    await sandbox.stop().catch(() => {})
  }
}
