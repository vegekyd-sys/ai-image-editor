import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 3189);
const files = {
  '/native.mp4': ['eco-tt04s-crop-native.mp4', 'video/mp4'],
  '/post.mp4': ['eco-tt04s-crop-post-overlay/final.mp4', 'video/mp4'],
  '/agent.mp4': ['agent-native-final.mp4', 'video/mp4'],
  '/editable.json': ['eco-tt04s-crop-post-overlay/editable.json', 'application/json'],
  '/native.jpg': ['eco-crop-native-contact.jpg', 'image/jpeg'],
  '/post.jpg': ['eco-post-contact.jpg', 'image/jpeg'],
};
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Makaron 音画与字幕实验</title><style>body{margin:0;padding:28px;background:#f5f4f1;color:#222;font:15px/1.7 system-ui}h1{font-size:25px;margin:0}p{max-width:900px;color:#555}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:22px}article{background:white;padding:18px;border-radius:12px}h2{font-size:19px;margin:0 0 8px}video{width:100%;max-height:630px;background:#111;border-radius:5px}small{display:block;color:#666}a{color:#2158a6}strong{color:#222}</style><h1>音画一次生成，字幕分开比较</h1><p>同一产品、同一讲解者参考、同一英文口播与 25 秒规格。两组均由 <strong>Seedance 2.5 Eco 原生生成音画</strong>。下方为独立实验产物，修复尚未合并上线。</p><div class="grid"><article><h2>模型原生字幕</h2><video controls preload="metadata" src="/native.mp4"></video><p>一次生成音画字幕。实际出现 <strong>range hot、ft hard-working</strong> 等错字，无法保证公司名与精确文案。</p><small>720×1280 · 约 25 秒 · 原生声音</small></article><article><h2>后期可编辑字幕</h2><video controls preload="metadata" src="/post.mp4"></video><p>原生音画保留，按实测语音时间加 15 组字幕和型号/公司名。<strong>没有 Studio，没有重新生成音频。</strong></p><small>720×1280 · 601 帧 / 24 fps · 原声 PCM 一致</small><a href="/editable.json" download="tt04s-editable.json">下载可编辑合成源文件</a></article></div><p>字幕对比是两条受控生成样本，并非同一画面的严格配对。原生音画提升了制作路径，但产品内部细节、人物口型仍需要成片审阅。</p></html>`;
http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
  const item = files[url.pathname];
  if (!item) { res.writeHead(404); res.end(); return; }
  const target = path.join(root, item[0]);
  if (!fs.existsSync(target)) { res.writeHead(404); res.end('Not ready'); return; }
  const size = fs.statSync(target).size;
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) { res.writeHead(416); res.end(); return; }
  res.writeHead(range ? 206 : 200, { 'Content-Type': item[1], 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(target, { start, end }).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('Review: http://localhost:' + port));
