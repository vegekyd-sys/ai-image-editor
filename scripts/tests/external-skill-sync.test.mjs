import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCatalog, syncDirectory, replaceDirectory, routingFingerprint } from '../lib/external-skill-directory.ts';
import { checkRoutingEvidence } from '../lib/skill-routing-evidence.ts';
const root = process.cwd();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'makaron-skill-sync-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const relative of ['config','src/skills','src/generated','src/lib','packages/makaron-cli','docs/agent-guidance/makaron-cli-entry.zh.md','benchmarks/external-skill-routing']) {
    fs.mkdirSync(path.dirname(path.join(dir,relative)),{recursive:true});fs.cpSync(path.join(root,relative),path.join(dir,relative),{recursive:true});
  }
  return dir;
}
test('the reviewed nine entries preserve the four exclusions',()=>{
  const c=buildCatalog(root); assert.equal(c.entries.length,9);
  assert.deepEqual(c.excluded,['motion-design-video','source-video-studio','website-to-video','reference-video-studio']);
  for(const name of c.excluded) assert.ok(!c.entries.some(e=>e.name===name));
});
test('metadata changes invalidate outputs and regeneration preserves manual prose',t=>{
  const dir=fixture(t);syncDirectory(dir);const before=buildCatalog(dir).revision;
  const file=path.join(dir,'src/skills/explainer-video/SKILL.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('Create an explainer video','Create a reviewed explainer video').replace('builtIn: true','builtIn: true\n    triggers: [explain-me]\n    inputHint: Provide a source clip').replace('sourceMediaRequired: false','sourceMediaRequired: true'));
  const updated=buildCatalog(dir).entries.find(e=>e.name==='explainer-video');assert.deepEqual(updated.triggers,['explain-me']);assert.equal(updated.sourceMediaRequired,true);assert.equal(updated.inputHint,'Provide a source clip');
  assert.notEqual(buildCatalog(dir).revision,before);assert.throws(()=>syncDirectory(dir,true),/stale/);
  const readme=path.join(dir,'packages/makaron-cli/README.md');fs.appendFileSync(readme,'\nManual prose must survive.\n');syncDirectory(dir);syncDirectory(dir,true);
  assert.match(fs.readFileSync(readme,'utf8'),/Manual prose must survive/);
  assert.match(fs.readFileSync(path.join(dir,'docs/agent-guidance/makaron-cli-entry.zh.md'),'utf8'),/跨段人物/);
});
test('body-only changes invalidate routing evidence but keep npm catalogue stable',t=>{
  const dir=fixture(t);const revision=buildCatalog(dir).revision, fingerprint=routingFingerprint(dir);
  fs.appendFileSync(path.join(dir,'src/skills/explainer-video/SKILL.md'),'\nNew production instruction.\n');
  assert.equal(buildCatalog(dir).revision,revision);assert.notEqual(routingFingerprint(dir),fingerprint);
});
test('renames, hidden, duplicate and excluded entries fail',t=>{
  const dir=fixture(t);const policyFile=path.join(dir,'config/makaron-external-skills.json');const original=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  for(const entry of [original.entries[0],{name:original.excluded[0],request:{en:'x',zh:'x'}},{name:'missing-entry',request:{en:'x',zh:'x'}}]){
    fs.writeFileSync(policyFile,JSON.stringify({...original,entries:[...original.entries,entry]}));assert.throws(()=>buildCatalog(dir));
  }
  fs.writeFileSync(policyFile,JSON.stringify(original));const file=path.join(dir,'src/skills/explainer-video/SKILL.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('builtIn: true','builtIn: true\n    manifestVisible: false'));assert.throws(()=>buildCatalog(dir),/hidden/);
});
test('malformed generated markers are rejected',()=>{
  assert.throws(()=>replaceDirectory('<!-- makaron:workflow-directory:start -->','x'),/Malformed/);
  assert.throws(()=>replaceDirectory('no table','x'),/Missing/);
});
test('routing receipt tampering and source drift fail the gate',t=>{
  const dir=fixture(t);const receipt=JSON.parse(fs.readFileSync(path.join(dir,'benchmarks/external-skill-routing/accepted.json'),'utf8'));
  checkRoutingEvidence(dir,receipt);receipt.rows[0].calls.push({name:'generate_animation',executed:true});assert.throws(()=>checkRoutingEvidence(dir,receipt),/unsafe/);
  receipt.rows[0].calls.pop();fs.appendFileSync(path.join(dir,'src/skills/_shared/native-audiovisual.md'),'\nUpdated shared routing rule.\n');assert.throws(()=>checkRoutingEvidence(dir,receipt),/stale/);
});
