/** Runs beside the pinned renderer's node_modules; one browser per frame batch. */
export const PREVIEW_BATCH_SCRIPT = String.raw`
import fs from 'node:fs/promises';
import {openBrowser, selectComposition, renderStill} from '@remotion/renderer';
const {config,frames,outputs}=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
let browser;
try {
  browser=await openBrowser('chrome',{
    browserExecutable:config.browserExecutable,chromiumOptions:config.chromiumOptions,
    chromeMode:config.chromeMode,logLevel:config.logLevel,
  });
  const common={...config,puppeteerInstance:browser};
  const composition=await selectComposition({...common,id:config.compositionId});
  const frameMs=[];
  // Pinned 4.0.448 lacks sparse frames[] and aligns everyNthFrame to zero.
  // Use exact stills rather than rendering extra frames or shifting timelines.
  for(let i=0;i<frames.length;i++){
    const start=Date.now();
    await renderStill({...common,composition,frame:frames[i],output:outputs[i],overwrite:true,isProduction:true});
    frameMs.push(Date.now()-start);
  }
  await fs.writeFile(outputs[0]+'.metrics.json',JSON.stringify({frameMs}));
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {
  await browser?.close({silent:true});
}
`;
