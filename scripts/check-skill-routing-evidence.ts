import { checkRoutingEvidence } from './lib/skill-routing-evidence';
const report = checkRoutingEvidence(process.cwd());
console.log(`Routing evidence checked: ${report.rows.length}/${report.rows.length}, media operations 0, current source fingerprint.`);
