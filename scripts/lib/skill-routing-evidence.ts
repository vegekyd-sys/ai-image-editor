import { buildCatalog, routingFingerprint } from './external-skill-directory';
import fs from 'node:fs';
import path from 'node:path';

export function matchesSkillReads(
  scenario: { expected: string; additionalSkills?: string[]; excludedSkills?: string[] },
  paths: string[],
) {
  const read = (name: string) => paths.includes(`skills/${name}/SKILL.md`);
  return read(scenario.expected)
    && (scenario.additionalSkills ?? []).every(read)
    && (scenario.excludedSkills ?? []).every(name => !read(name));
}

export function checkRoutingEvidence(root: string, receipt?: any) {
  const report = receipt || JSON.parse(fs.readFileSync(path.join(root,'benchmarks/external-skill-routing/accepted.json'),'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(root,'benchmarks/external-skill-routing/cases.json'),'utf8'));
  const catalog = buildCatalog(root);
  const fail = (why: string): never => { throw new Error(`Routing evidence ${why}; run the authorized routing-only preflight before release`); };
  if(report.routingFingerprint !== routingFingerprint(root) || report.catalogRevision !== catalog.revision) fail('is stale');
  if(report.kind !== 'controlled-live-natural-language-routing' || report.mediaOperationsExecuted !== 0 || report.maxStepsPerCase !== 5 || report.maxRetries !== 0 || report.rows?.length !== cases.length) fail('has invalid bounds');
  cases.forEach((scenario: any, i: number) => {
    const row = report.rows[i];
    if(row.id !== scenario.id || row.prompt !== scenario.prompt || row.expected !== scenario.expected || !catalog.entries.some(e=>e.name===row.expected) || row.passed !== true || row.selected !== true || row.stoppedBeforeProduction !== true || row.error || !row.text?.trim()) fail(`failed for ${scenario.id}`);
    if(!Array.isArray(row.calls) || row.calls.some((c:any)=>c.name!=='read_file' || c.blocked || c.error || c.executed !== true)) fail(`executed unsafe or unsuccessful tools for ${scenario.id}`);
    if(!matchesSkillReads(scenario, row.calls.map((call:any) => call.path))) fail(`read the wrong skills for ${scenario.id}`);
  });
  return report;
}
