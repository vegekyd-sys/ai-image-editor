"""Extend the private report with existing low receipts; performs no API calls."""
import json
import shutil
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parents[2]
source = root / 'test-results/tips-luna-low-v1'
prior = root / 'test-results/tips-luna-e2e-v1'
dist = root / 'sites/nano-banana-21-report/dist'
assets = dist / 'assets/luna-low'
assets.mkdir(parents=True, exist_ok=True)
load = lambda folder, name: json.loads((folder / name).read_text())
old = load(dist, 'luna-data.json')
text = load(source, 'luna_low.json')
images = load(source, 'images.json')['rows']
summary = load(source, 'summary.json')
raw = [json.loads(r['requests'][0]['rawText'].strip().removeprefix('```json').removesuffix('```').strip()) for r in text['rows']]
assert len(images) == 20 and all(r['state'] not in ['pending', 'submitted'] for r in images)
assert all(r['costMissing'] == 0 for r in text['rows'])
high = load(prior, 'luna.json')
assert all(r['inputHash'] == h['inputHash'] and r['requests'][0]['promptHash'] == h['requests'][0]['promptHash']
    and r['requests'][0]['reasoning']['effort'] == 'low' for r, h in zip(text['rows'], high['rows']))
assert load(source, 'protocol.json')['promptFiles'] == load(prior, 'protocol.json')['promptFiles']
audit = dict(initialMsMean=sum(r['requests'][0]['totalMs'] for r in text['rows']) / 10,
    initialCostUsd=sum(r['requests'][0]['usage']['cost'] for r in text['rows']),
    rawComplete=sum(len(t) == 2 and all(x.get('label') and x.get('desc') and x.get('editPrompt') for x in t) for t in raw),
    missingCategoryCells=sum(any(not x.get('category') for x in t) for t in raw),
    withoutRepair=sum(len(r['requests']) == 1 for r in text['rows']),
    repairCostUsd=sum(q['usage']['cost'] for r in text['rows'] for q in r['requests'] if q['phase'] == 'editPrompt-repair'),
    initialReasoningTokensMean=sum(r['requests'][0]['usage'].get('completion_tokens_details', {}).get('reasoning_tokens', 0) for r in text['rows']) / 10)

def asset(file):
    target = assets / Path(file).name
    shutil.copy2(source / file, target)
    thumb = assets / (target.stem + '-thumb.jpg')
    ImageOps.contain(Image.open(target).convert('RGB'), (650, 650)).save(thumb, quality=85)
    return str(target.relative_to(dist)), str(thumb.relative_to(dist))

notes_file = source / 'review-notes.json'
notes = load(source, 'review-notes.json') if notes_file.exists() else {}
cases = []
for c in old['cases']:
    entry = dict(c)
    entry['outputs'], entry['text'] = dict(c['outputs']), dict(c['text'])
    r = dict(next(r for r in images if r['imageIndex'] == c['imageIndex'] and r['category'] == c['category'] and r['tipIndex'] == c['tipIndex']))
    if r.get('image'): r['image'], r['thumb'] = asset(r['image'])
    entry['outputs']['luna_low'] = r
    entry['text']['luna_low'] = next(t for t in text['rows'] if t['imageIndex'] == c['imageIndex'] and t['category'] == c['category'])
    entry['previousNote'] = c['note']
    entry['note'] = notes.get(c['id'], '待人工查看，不提供预填质量评分。')
    cases.append(entry)

# Contact sheets are local review evidence, never a substituted generated result.
contact = source / 'contact'
contact.mkdir(exist_ok=True)
for i in range(5):
    for category in ['creative', 'wild']:
        group = [c for c in cases if c['imageIndex'] == i and c['category'] == category]
        canvas = Image.new('RGB', (2100, 410), '#f7f5f0')
        draw = ImageDraw.Draw(canvas)
        items = [('Original', dist / group[0]['original'])]
        for c in group:
            for author, label in [('online', 'NB2'), ('luna', 'High'), ('luna_low', 'Low')]:
                r = c['outputs'][author]
                if r.get('image'): items.append((label + ' ' + str(c['tipIndex'] + 1), dist / r['image']))
        for n, (label, file) in enumerate(items):
            thumb = ImageOps.contain(Image.open(file).convert('RGB'), (294, 365))
            canvas.paste(thumb, (n * 300 + (300 - thumb.width) // 2, 30 + (365 - thumb.height) // 2))
            draw.text((n * 300 + 8, 8), label, fill='#27212d')
        canvas.save(contact / f'{i}-{category}.jpg', quality=94)

combined = dict(old['summary'])
combined['authors'] = {**old['summary']['authors'], **summary['authors']}
data = dict(summary=combined, lowProtocol=summary['protocol'], audit={**old['audit'], 'luna_low': audit}, cases=cases,
    lowParserReplay=load(source, 'parser-replay.json'), priorBaseline=old['baseline'], prices=load(source, 'prices.json'),
    comparison='Online and Luna high artifacts reused from previous run; new paid work is Luna low only. All three use identical legacy parser and initial prompts, not the candidate fix. Different ideas paired by ordinal.')
if (source / 'quality-verdict.json').exists(): data['qualityVerdict'] = load(source, 'quality-verdict.json')['text']
(dist / 'luna-low-data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
link = '<aside id="luna-low-update"><strong>补测完成：Luna low</strong><p>保留上一轮链路，只改变推理档位。新增 20 张 low 成品，与线上和 high 三方比较。</p><a class="outline download" href="luna-low.html">查看 Luna low 的速度、费用与成品 ↗</a></aside>'
for file, marker in [('luna.html', '<section class="numbers"'), ('index.html', '<section class="feature">')]:
    p = dist / file
    html = p.read_text()
    if 'id="luna-low-update"' not in html: html = html.replace(marker, link + marker, 1)
    p.write_text(html)
print(json.dumps({'cases': len(cases), 'newImageSuccess': sum(r['state'] == 'success' for r in images), 'matchingInputsAndPrompts': 10, 'audit': audit, 'reviewedNotes': len(notes)}, ensure_ascii=False))
