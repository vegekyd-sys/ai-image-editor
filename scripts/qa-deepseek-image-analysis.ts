import { createTools } from '../src/lib/agent-tools';
import { createAgentModelRuntime } from '../src/lib/agent-model-runtime';

async function main() {
  const image = 'https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/4a4a543e-2913-45cd-8ec4-dc688e7893ca/snapshot-c9901050-7a80-4d47-84ec-63dd1312f9dc.jpg';
  const runtime = createAgentModelRuntime('deepseek-v4-pro', 'language-analysis-probe');
  const tools = createTools({ currentImage:image, projectId:'language-analysis-probe', generatedImages:[],snapshotImages:[image],explicitMediaIndices:[1],currentSnapshotIndex:0 },runtime,'en');
  try {
    const result = await (tools.analyze_image.execute as any)({question:'Describe the subject, clothes and background.'},{toolCallId:'probe',messages:[],abortSignal:AbortSignal.timeout(45000)});
    console.log(JSON.stringify({ok:true,result}));
  } catch (error:any) {
    const message = String(error?.message ?? error).replace(/AIza[\w-]+/g,'[redacted]');
    console.log(JSON.stringify({ok:false,name:error.name,status:error.status,message}));
  }
}
main();
