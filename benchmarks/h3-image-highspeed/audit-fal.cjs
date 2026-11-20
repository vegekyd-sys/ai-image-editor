// Optional, read-only, request-scoped account lookups. Keep provider IDs out of the public report.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const dir = path.resolve(process.argv[2]);
  const report = {};
  let canReadBilling = true;
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('-h3.private.json') || n === 'alpha.private.json')) {
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const sample = f.replace('.private.json', '');
    const endpoint = 'minimax/h3-image/highspeed/' + (f.includes('-edit-') ? 'edit' : 'text-to-image');
    const entry = {};
    for (const route of ['requests/by-endpoint', 'billing-events']) {
      if (route === 'billing-events' && !canReadBilling) {
        entry[route] = 'skipped after HTTP 403';
        continue;
      }
      const url = new URL('https://api.fal.ai/v1/models/' + route);
      url.searchParams.set('endpoint_id', endpoint);
      url.searchParams.set('request_id', receipt.id);
      const key =
        route === 'billing-events' ? process.env.FAL_BILLING_KEY || process.env.FAL_KEY : process.env.FAL_KEY;
      const r = await fetch(url, {
        headers: { Authorization: 'Key ' + key.trim() },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      entry[route] = r.status;
      if (route === 'billing-events' && r.status === 403) canReadBilling = false;
      if (!r.ok) continue;
      const data = await r.json();
      const rows = (data.items || data.billing_events || []).filter(
        (v) => v.request_id === receipt.id && v.endpoint_id === endpoint,
      );
      if (route === 'requests/by-endpoint' && rows.length === 1) {
        const { sent_at, started_at, ended_at, duration } = rows[0];
        Object.assign(entry, {
          sent_at,
          started_at,
          ended_at,
          duration,
          queueMs: Date.parse(started_at) - Date.parse(sent_at),
        });
      }
      if (route === 'billing-events' && rows.length)
        entry.events = rows.map(({ quantity, unit_price, cost_subtotal, cost_discount, cost_total }) => ({
          quantity,
          unit_price,
          cost_subtotal,
          cost_discount,
          cost_total,
        }));
    }
    report[sample] = entry;
  }
  fs.writeFileSync(path.join(dir, 'fal-account.json'), JSON.stringify(report, null, 2) + '\n');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
