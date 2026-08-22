#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileEditableManifestWithProvenance } from '../src/lib/editor/editable-provenance-compiler';
import { renderDesignVideoLambdaToUrl } from '../src/lib/remotion-lambda-renderer';
import type { DesignPayload } from '../src/types';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function toneDataUrl(durationSeconds: number): string {
  const sampleRate = 16_000;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index++) {
    const fade = Math.min(1, index / 800, (sampleCount - index) / 800);
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0.12 * fade;
    wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}

function minimalRepeatedCaptionDesign(): {
  design: DesignPayload;
  helperInjected: boolean;
} {
  const props: Record<string, unknown> = {
    captionA: 'Before it wins a rally, a badminton racket survives a tiny factory Olympics.',
    captionB: 'Lambda 导出必须保持一个完整字幕背景',
    audioSrc: toneDataUrl(3),
  };
  const authoredCode = `
const {AbsoluteFill,Sequence,Audio}=Remotion;
function Caption({text}) {
  return <div style={{width:420,fontFamily:'Inter, Noto Sans SC, sans-serif',fontSize:42,fontWeight:800,lineHeight:1.18,color:'white'}}>
    <div style={{display:'inline',backgroundColor:'rgba(13,12,13,.72)',boxShadow:'0 0 0 14px rgba(13,12,13,.72)',boxDecorationBreak:'clone',WebkitBoxDecorationBreak:'clone'}}>{text}</div>
  </div>;
}
function Composition(props) {
  const captions=[
    {from:0,text:props.captionA},
    {from:45,text:props.captionB},
  ];
  return <AbsoluteFill style={{backgroundColor:'#17131f',alignItems:'center',justifyContent:'center'}}>
    <Audio src={props.audioSrc} volume={0.12}/>
    {captions.map((caption)=><Sequence key={caption.from} from={caption.from} durationInFrames={45} layout="none"><Caption text={caption.text}/></Sequence>)}
  </AbsoluteFill>;
}`.trim();
  const compiled = compileEditableManifestWithProvenance({ code: authoredCode, props });
  if (compiled.diagnostics.length > 0) {
    throw new Error(`Minimal provenance compile failed: ${compiled.diagnostics.join('; ')}`);
  }
  const helperInjected = compiled.code.includes('React.__makaronEditableId');
  if (!helperInjected) {
    throw new Error('Minimal repeated-caption composition did not inject React.__makaronEditableId');
  }
  for (const id of ['captionA', 'captionB']) {
    if (!compiled.editables.some(field => field.id === id)) {
      throw new Error(`Minimal repeated-caption composition is missing editable ${id}`);
    }
  }
  return {
    helperInjected,
    design: {
      code: compiled.code,
      props,
      editables: compiled.editables,
      width: 640,
      height: 360,
      animation: { fps: 30, durationInSeconds: 3, format: 'mp4' },
    },
  };
}

async function loadProjectDesign(projectId: string, requestedDesignPath?: string): Promise<{
  design: DesignPayload;
  snapshotId: string | null;
  designPath: string;
  title: string;
}> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serviceRoleKey || requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let projectQuery = supabase
    .from('projects')
    .select('id,title,user_id,is_public')
    .eq('id', projectId);
  if (!serviceRoleKey) projectQuery = projectQuery.eq('is_public', true);
  const { data: project, error: projectError } = await projectQuery.single();
  if (projectError) throw projectError;
  if (requestedDesignPath) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from('images')
      .download(`${project.user_id}/workspace/${requestedDesignPath}`);
    if (downloadError) throw downloadError;
    return {
      design: JSON.parse(await blob.text()) as DesignPayload,
      snapshotId: null,
      designPath: requestedDesignPath,
      title: project.title || projectId,
    };
  }
  const { data: snapshot, error: snapshotError } = await supabase
    .from('snapshots')
    .select('id,design_path,created_at')
    .eq('project_id', projectId)
    .not('design_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (snapshotError) throw snapshotError;
  if (!snapshot.design_path) throw new Error(`Project ${projectId} has no Composition`);
  const { data: blob, error: downloadError } = await supabase.storage
    .from('images')
    .download(`${project.user_id}/workspace/${snapshot.design_path}`);
  if (downloadError) throw downloadError;
  return {
    design: JSON.parse(await blob.text()) as DesignPayload,
    snapshotId: snapshot.id,
    designPath: snapshot.design_path,
    title: project.title || projectId,
  };
}

function safeProgress(value: unknown): Record<string, unknown> {
  const progress = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const errors = Array.isArray(progress.errors)
    ? progress.errors.map(error => (
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : String(error)
      ))
    : [];
  return {
    phase: progress.phase ?? null,
    progress: progress.progress ?? null,
    renderId: progress.renderId ?? null,
    elapsedSeconds: progress.elapsedSeconds ?? null,
    done: progress.done ?? false,
    fatalErrorEncountered: progress.fatalErrorEncountered ?? false,
    errors,
  };
}

function withoutCapabilityUrls<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, child) => (
    key.toLowerCase().endsWith('url') ? undefined : child
  ))) as T;
}

async function main(): Promise<void> {
  const outputDir = path.resolve(readArg('--output-dir') || '/tmp/makaron-remotion-lambda-runtime-regression');
  const projectId = readArg('--project-id');
  const designPath = readArg('--design-path');
  if (designPath && !projectId) throw new Error('--design-path requires --project-id');
  const testName = projectId ? `project-${projectId}` : 'minimal-repeated-captions';
  await mkdir(outputDir, { recursive: true });

  let design: DesignPayload;
  let helperInjected = false;
  let source: Record<string, unknown>;
  if (projectId) {
    const loaded = await loadProjectDesign(projectId, designPath);
    design = loaded.design;
    source = {
      kind: 'public-project',
      projectId,
      snapshotId: loaded.snapshotId,
      designPath: loaded.designPath,
      title: loaded.title,
    };
  } else {
    const minimal = minimalRepeatedCaptionDesign();
    design = minimal.design;
    helperInjected = minimal.helperInjected;
    source = { kind: 'generated-minimal' };
  }

  const progressEvents: Record<string, unknown>[] = [];
  const startedAt = Date.now();
  const rendered = await renderDesignVideoLambdaToUrl(design, {
    onProgress: (progress) => {
      const event = safeProgress(progress);
      progressEvents.push(event);
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  });
  const response = await fetch(rendered.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Lambda MP4 download failed with HTTP ${response.status}`);
  const output = Buffer.from(await response.arrayBuffer());
  const mp4Path = path.join(outputDir, `${testName}.mp4`);
  const progressPath = path.join(outputDir, `${testName}.progress.json`);
  const resultPath = path.join(outputDir, `${testName}.result.json`);
  await writeFile(mp4Path, output);
  await writeFile(progressPath, JSON.stringify(progressEvents, null, 2));

  const fontProps = Object.fromEntries(
    Object.entries(design.props || {}).filter(([key]) => /^font/i.test(key)),
  );
  const errors = Array.isArray(rendered.progress.errors)
    ? rendered.progress.errors.map(error => error.message)
    : [];
  const result = {
    testName,
    source,
    serveUrl: requiredEnv('REMOTION_LAMBDA_SERVE_URL'),
    renderId: rendered.renderId,
    bucketName: rendered.bucketName,
    functionName: rendered.functionName,
    rendererFunctionName: rendered.rendererFunctionName,
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    downloadedBytes: output.length,
    outputSizeInBytes: rendered.outputSizeInBytes,
    totalElapsedSeconds: Math.round((Date.now() - startedAt) / 10) / 100,
    renderSeconds: rendered.renderSeconds,
    helperInjected,
    codeContainsEditableHelper: design.code.includes('React.__makaronEditableId'),
    editableCount: design.editables?.length || 0,
    editableIds: design.editables?.map(field => field.id) || [],
    fontProps,
    width: design.width,
    height: design.height,
    animation: design.animation,
    errors,
    timings: withoutCapabilityUrls(rendered.timings),
    mp4Path,
    progressPath,
  };
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, resultPath }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
