"""Package existing paid receipts and images for the private Sites report. No API calls."""
import json
import shutil
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parents[2]
source = root / 'test-results/tips-luna-e2e-v1'
dist = root / 'sites/nano-banana-21-report/dist'
assets = dist / 'assets/luna'
assets.mkdir(parents=True, exist_ok=True)
load = lambda name: json.loads((source / name).read_text())
summary, images = load('summary.json'), load('images.json')['rows']
assert len(images) == 40 and all(r['state'] == 'success' for r in images)
authors = {name: load(name + '.json') for name in ['online', 'luna']}
audit = {}
for author, record in authors.items():
    first, rows = [], record['rows']
    for row in rows:
        raw = row['requests'][0]['rawText'].strip().removeprefix('```json').removesuffix('```').strip()
        first.append(json.loads(raw))
    audit[author] = dict(initialMsMean=sum(r['requests'][0]['totalMs'] for r in rows) / len(rows),
        initialCostUsd=sum(r['requests'][0]['usage']['cost'] for r in rows),
        rawComplete=sum(len(t) == 2 and all(x.get('label') and x.get('desc') and x.get('editPrompt') for x in t) for t in first),
        missingCategoryCells=sum(any(not x.get('category') for x in t) for t in first),
        withoutRepair=sum(len(r['requests']) == 1 for r in rows),
        repairCostUsd=sum(q['usage']['cost'] for r in rows for q in r['requests'] if q['phase'] == 'editPrompt-repair'))
    assert all(r['costMissing'] == 0 for r in rows)
assert all(x['inputHash'] == y['inputHash'] and x['requests'][0]['promptHash'] == y['requests'][0]['promptHash']
    for x, y in zip(authors['online']['rows'], authors['luna']['rows']))

def asset(file):
    target = assets / Path(file).name
    shutil.copy2(source / file, target)
    thumb = assets / (target.stem + '-thumb.jpg')
    im = Image.open(target).convert('RGB')
    assert im.width > 0 and im.height > 0
    ImageOps.contain(im, (650, 650)).save(thumb, quality=85)
    return str(target.relative_to(dist)), str(thumb.relative_to(dist))

notes = {
    '0-creative-0': '线上仓鼠是小幅点缀，Luna 把盖章和人物动作连起来；两边脸与桌面基本保留。',
    '0-creative-1': '线上寻宝地图改变桌面更醒目；Luna 的纸张漂浮能看见，但“纸海失控”的规模偏小。',
    '0-wild-0': '线上墙画角色变化局限在背景小区域；Luna 的纸上校园在桌面形成清晰立体建筑。',
    '0-wild-1': '线上把手机投影改成了电影放映机，概念有偏移；Luna 的木浪变化很弱，接近原图。',
    '1-creative-0': '水獭管理员和馆猫都自然融入图书馆，前者更拟人，后者与书本关系更直接。',
    '1-creative-1': '线上飞书的动态效果更明显；Luna 的“静音违规”主要变成桌面印章，故事需要读文案才清楚。',
    '1-wild-0': '线上发光书树与 Luna 纸页旋涡都形成明显奇观；人物仍然可辨认，是这轮两边都较好的组合。',
    '1-wild-1': '线上知识流围绕背景展开；Luna 巨灯把镜头拉远，人物比例与构图也发生了变化。',
    '2-creative-0': '线上牙缝登山者非常微小，嘴部多了复杂细节；Luna 鸽子站手的互动更容易看懂。',
    '2-creative-1': '线上手掌小居民没有形成预期的完整小人场景；Luna 加入街头画家，人物表情仍接近原图。',
    '2-wild-0': '线上眼镜框小手改动较局部；Luna 管风琴奇观明显，但也拉远了自拍构图。',
    '2-wild-1': '线上本格是旧解析器转义标签导致的重复“眼镜框活了”，不是首轮真正第二条“苔藓外套微景观”。Luna 红旗扩大效果清楚。保留此图作为当前产品链路证据；候选解析器已离线恢复正确两条，未为修复另付费出图。',
    '3-creative-0': '线上 T 恤人像的变化很细微；Luna 的鸽子抢串更醒目，但孩子追拦的动作不突出。',
    '3-creative-1': '线上探宝添加了未经要求的画面文字；Luna 鱼丸下落形成直接可见的互动。',
    '3-wild-0': '线上豆角精灵更像彩色光轨，小人不易辨认；Luna 把食材垒成明显喷泉，创意更直接。',
    '3-wild-1': '线上红幕变成光带，Luna 红幕形成巨型布浪；后者仍能辨认布料褶皱，与原图材质更相连。',
    '4-creative-0': '线上微型漂流模型出现在人物前方，有新增台面的痕迹；Luna 山羊直接抢镜，尺度和现场关系更自然。',
    '4-creative-1': '线上发间水龙卷清楚可见；Luna 增加举桨向导呼应手势，两种点子都落地。',
    '4-wild-0': '线上巨大望远镜遮住眼睛，牺牲了部分人脸；Luna 巨浪主要改背景，脸更完整。',
    '4-wild-1': '线上加了飞吻嘴唇和小精灵，Luna 把背景巨石变成紫色晶洞；两边变化都明确，偏局部编辑。',
}
override = source / 'review-notes.json'
if override.exists(): notes.update(json.loads(override.read_text()))
names = ['讨论桌', '图书馆', '建筑合照', '夜市', '峡谷']
cases = []
for i in range(5):
    original, original_thumb = asset(f'images/{i}-original.jpg')
    for category in ['creative', 'wild']:
        group = [r for r in images if r['imageIndex'] == i and r['category'] == category]
        for tip_index in range(2):
            outputs = {}
            texts = {}
            for author in authors:
                r = dict(next(r for r in group if r['author'] == author and r['tipIndex'] == tip_index))
                r['image'], r['thumb'] = asset(r['image'])
                outputs[author] = r
                texts[author] = next(t for t in authors[author]['rows'] if t['imageIndex'] == i and t['category'] == category)
            cid = f'{i}-{category}-{tip_index}'
            cases.append(dict(id=cid, imageIndex=i, category=category, tipIndex=tip_index,
                title=f'{names[i]} / {category.title()} / 建议 {tip_index + 1}', original=original, originalThumb=original_thumb,
                outputs=outputs, text=texts, note=notes[cid]))
        contact = source / 'contact'
        contact.mkdir(exist_ok=True)
        canvas = Image.new('RGB', (1500, 390), '#f7f5f0')
        draw = ImageDraw.Draw(canvas)
        items = [('Original', source / 'images' / f'{i}-original.jpg')] + [(r['author'] + ' ' + str(r['tipIndex'] + 1), source / r['image']) for r in group]
        for index, (label, file) in enumerate(items):
            thumb = ImageOps.contain(Image.open(file).convert('RGB'), (294, 350))
            canvas.paste(thumb, (index * 300 + (300 - thumb.width) // 2, 28 + (350 - thumb.height) // 2))
            draw.text((index * 300 + 8, 6), label, fill='#27212d')
        canvas.save(contact / f'{i}-{category}.jpg', quality=94)

data = dict(summary=summary, audit=audit, prices=load('prices.json'), cases=cases, parserReplay=load('parser-replay.json'),
    baseline=dict(productionDeployment='dpl_H9RMvVuG4FsRknFCSBbnYeoeNiBZ', source='Current main checkout Tips template/parser + freshly read production model configuration; not a direct production API request.'),
    completenessNote='20 structurally complete rendered outputs per author. Legacy online parser emitted one duplicate idea; raw first pass and offline patched replay contain two distinct ideas in that cell.')
(dist / 'luna-data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
index = dist / 'index.html'
html = index.read_text()
link = '<aside id="luna-update"><strong>新一轮：GPT-6 Luna 写 Tips</strong><p>同样 5 张原图，线上文案 vs Luna，再统一用 2.1 生成 40 张图片。看成品、速度、费用和解析器问题。</p><a class="outline download" href="luna.html">打开 Luna 文案成品对比 ↗</a></aside>'
if 'id="luna-update"' not in html: html = html.replace('<section class="feature">', link + '<section class="feature">', 1)
index.write_text(html)
print(json.dumps(dict(cases=len(cases), finalImages=len(images), matchingInputAndPromptCells=10, audit=audit), ensure_ascii=False))
