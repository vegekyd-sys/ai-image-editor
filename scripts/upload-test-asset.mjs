import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2];
const uploadKind = process.argv[3];
if (!filePath || !fs.existsSync(filePath)) throw new Error('Usage: upload-test-asset.mjs <file> [audio]');

const authPath = path.join(process.env.HOME, '.makaron', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const apiKey = process.env.MAKARON_API_KEY || auth._apiKey;
if (!apiKey) throw new Error('Makaron API key is not configured');
const baseUrl = process.env.MAKARON_URL || 'https://www.makaron.app';
const ext = path.extname(filePath).slice(1).toLowerCase();
const mime = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
}[ext] || 'application/octet-stream';

const signed = await fetch(`${baseUrl}/api/storage/upload-url`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ filename: path.basename(filePath), contentType: mime, uploadKind }),
});
if (!signed.ok) throw new Error(`Signed upload failed: ${signed.status} ${await signed.text()}`);
const { uploadUrl, token, publicUrl } = await signed.json();
const uploaded = await fetch(uploadUrl, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
  body: fs.readFileSync(filePath),
});
if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.status} ${await uploaded.text()}`);
console.log(publicUrl);
