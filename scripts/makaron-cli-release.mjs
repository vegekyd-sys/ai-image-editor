#!/usr/bin/env node
// Prepare never publishes. Verify checks the inspected tarball against npm and a fresh install.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkgDir=path.join(root,'packages/makaron-cli');
const args=process.argv.slice(2);
const value=(flag)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const run=(command,argv,options={})=>execFileSync(command,argv,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,...options});
const json=(file)=>JSON.parse(fs.readFileSync(file,'utf8'));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
function packageContract(){
  const pkg=json(path.join(pkgDir,'package.json'));
  for(const rel of ['.codex-plugin/plugin.json','.claude-plugin/plugin.json','evals/agent-discovery.json'])assert(json(path.join(pkgDir,rel)).version===pkg.version,`Version mismatch: ${rel}`);
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version),'CLI version must be a stable semver');
  return pkg;
}
function inspectTarball(file,pkg){
  const members=run('tar',['-tzf',file]).trim().split('\n');
  for(const name of members) assert(name.startsWith('package/') && !name.includes('..') && !name.endsWith('/'),`Unexpected tarball member: ${name}`);
  const contents=new Map(members.map(name=>[name.slice(8),run('tar',['-xOf',file,name],{encoding:null})]));
  const required=['package.json','bin/makaron.mjs','README.md','.codex-plugin/plugin.json','.claude-plugin/plugin.json','skills/makaron/SKILL.md'];
  const collect=(dir)=>{for(const entry of fs.readdirSync(path.join(pkgDir,dir),{withFileTypes:true})){const relative=dir+'/'+entry.name;if(entry.isDirectory())collect(relative);else required.push(relative);}};
  collect('skills/makaron/references');
  for(const relative of required)assert(contents.has(relative),`Tarball missing required file: ${relative}`);
  const bundled=JSON.parse(contents.get('package.json').toString());assert(bundled.version===pkg.version,'Tarball version differs from repository');
  for(const [relative,bytes] of contents) assert(fs.existsSync(path.join(pkgDir,relative)) && fs.readFileSync(path.join(pkgDir,relative)).equals(bytes),`Tarball source mismatch: ${relative}`);
  const catalog=json(path.join(pkgDir,'skills/makaron/references/workflow-catalog.json'));
  assert(contents.has('skills/makaron/references/workflow-catalog.json'),'Tarball omits generated catalogue');
  for(const entry of catalog.entries)assert(contents.get('skills/makaron/SKILL.md').toString().includes('`'+entry.name+'`'),`Tarball missing entry: ${entry.name}`);
  return {contents,catalog,shasum:createHash('sha1').update(fs.readFileSync(file)).digest('hex')};
}
function checkVersionChange(base,pkg,contents){
  if(!base)return;
  run('git',['rev-parse','--verify',`${base}^{commit}`]);
  const old=JSON.parse(run('git',['show',`${base}:packages/makaron-cli/package.json`]));
  let changed=false;
  for(const [relative,bytes]of contents){
    try{if(!run('git',['show',`${base}:packages/makaron-cli/${relative}`],{encoding:null,stdio:['ignore','pipe','ignore']}).equals(bytes))changed=true;}catch{changed=true;}
  }
  // Include removals from packed directories; tests/evals alone are not shipped.
  const packedPath=(p)=>p==='packages/makaron-cli/package.json'||p==='packages/makaron-cli/README.md'||/packages\/makaron-cli\/(?:bin|skills|\.codex-plugin|\.claude-plugin)\//.test(p);
  if(run('git',['diff','--name-only',base,'--','packages/makaron-cli']).trim().split('\n').some(packedPath))changed=true;
  assert(!changed||old.version!==pkg.version,'Shipped CLI contents changed without a version bump');
}
async function main(){
  assert(args.includes('--prepare')||args.includes('--verify'),'Use --prepare [--base <commit>] or --verify --tarball <inspected.tgz> [--report <json>]');
  const pkg=packageContract();
  const checks=args.includes('--prepare')?['check:skill-sync','test:skill-sync','test:cli','lint:agent-docs']:['check:skill-sync'];
  for(const check of checks)run('npm',['run',check],{stdio:'inherit'});
  if(args.includes('--prepare')){
    const out=value('--out')?path.resolve(value('--out')):fs.mkdtempSync(path.join(os.tmpdir(),'makaron-cli-release-'));
    fs.mkdirSync(out,{recursive:true});
    const packed=JSON.parse(run('npm',['pack',pkgDir,'--ignore-scripts','--json','--pack-destination',out]))[0];
    const file=path.join(out,packed.filename),inspected=inspectTarball(file,pkg);
    checkVersionChange(value('--base'),pkg,inspected.contents);
    const report={kind:'prepared-not-published',name:pkg.name,version:pkg.version,tarball:file,shasum:inspected.shasum,files:[...inspected.contents.keys()],catalogRevision:inspected.catalog.revision,entries:inspected.catalog.entries.map(e=>e.name)};
    fs.writeFileSync(path.join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return;
  }
  assert(value('--tarball'),'--verify requires the inspected --tarball');
  const file=path.resolve(value('--tarball')),inspected=inspectTarball(file,pkg);
  const dist=JSON.parse(run('npm',['view',`${pkg.name}@${pkg.version}`,'--json','--registry=https://registry.npmjs.org/']));
  const tags=JSON.parse(run('npm',['view',pkg.name,'dist-tags','--json','--registry=https://registry.npmjs.org/']));
  assert(dist.version===pkg.version&&dist.dist?.shasum===inspected.shasum,'Registry version or tarball hash mismatch');assert(tags.latest===pkg.version,'npm latest differs from release');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'makaron-cli-fresh-'));
  try{
    run('npm',['install','--prefix',temp,'--cache',path.join(temp,'cache'),'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/',`${pkg.name}@${pkg.version}`]);
    const installed=path.join(temp,'node_modules',pkg.name);
    for(const [relative,bytes]of inspected.contents)assert(fs.readFileSync(path.join(installed,relative)).equals(bytes),`Fresh install mismatch: ${relative}`);
    const bin=path.join(installed,'bin/makaron.mjs');
    const version=run(process.execPath,[bin,'--version']).trim();assert(version.includes(pkg.version),'Fresh CLI version mismatch');
    assert(run(process.execPath,[bin,'chat','--help']).includes('--skill'),'Fresh CLI help missing --skill');
    // Read-only production discovery. No project/run/media creation.
    const discovered=JSON.parse(run(process.execPath,[bin,'skills','list','--built-in','--json']));
    const names=new Set((Array.isArray(discovered)?discovered:discovered.skills||discovered.data?.skills||discovered.data||[]).map(e=>e.name));
    for(const entry of inspected.catalog.entries)assert(names.has(entry.name),`Live service does not expose ${entry.name}`);
    const report={kind:'registry-fresh-install-readonly-accepted',version:pkg.version,latest:tags.latest,shasum:inspected.shasum,filesCompared:inspected.contents.size,catalogRevision:inspected.catalog.revision,discoveredEntries:inspected.catalog.entries.map(e=>e.name),mediaOperationsExecuted:0};
    if(value('--report'))fs.writeFileSync(path.resolve(value('--report')),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(`CLI release gate failed: ${e.message}`);process.exitCode=1;});
