// Suno V6 duration/ending strategy test. Usage: node gen.mjs [filter]
import fs from 'node:fs'
const env = fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.local', 'utf8')
const KEY = env.match(/^SUNOAPI_KEY=["']?([^"'\n]+)/m)[1].trim()
const BASE = 'https://api.sunoapi.org/api/v1'
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
fs.mkdirSync('raw', { recursive: true })

const STYLE = {
  lofi: { s: 'lo-fi chill hop, mellow electric piano, warm vinyl crackle, relaxed, dreamy pads', bpm: 80 },
  upbeat: { s: 'upbeat travel vlog, acoustic guitar, ukulele, claps, light percussion, bright and playful', bpm: 110 },
  edm: { s: 'energetic EDM sports promo, punchy four-on-the-floor kick, side-chained synth chords, supersaw lead', bpm: 128 },
  cinematic: { s: 'epic cinematic orchestral trailer, taiko drums, low brass, rising strings, heroic', bpm: 90 },
}
const bars = (sec, bpm) => Math.max(4, Math.round(sec / (240 / bpm)))
function tags(sec, bpm) {
  const n = bars(sec, bpm)
  const intro = n >= 16 ? 4 : 2, outro = n >= 16 ? 4 : 2
  const mid = n - intro - outro
  return sec >= 45
    ? `[Intro: ${intro} bars]\n[Main Theme: ${Math.ceil(mid / 2)} bars]\n[Variation: ${Math.floor(mid / 2)} bars]\n[Outro: ${outro} bars, final chord]\n[End]`
    : `[Intro: ${intro} bars]\n[Main Theme: ${mid} bars]\n[Outro: ${outro} bars, final chord]\n[End]`
}
const NEG = 'vocals, singing, voice, humming, choir, spoken word'
const STRATS = {
  // current production body
  base: (st, d) => ({ instrumental: true, style: `${STYLE[st].s}, instrumental`, prompt: '', duration: d }),
  // structure tags in prompt while instrumental=true (may be ignored)
  tagsI: (st, d) => ({ instrumental: true, style: `${STYLE[st].s}, ${STYLE[st].bpm} BPM, instrumental`, prompt: tags(d, STYLE[st].bpm), duration: d }),
  // tags-only "lyrics" with instrumental=false, vocals pushed out by negativeTags
  tagsL: (st, d) => ({ instrumental: false, style: `${STYLE[st].s}, ${STYLE[st].bpm} BPM, instrumental, no vocals`, prompt: `[Instrumental]\n${tags(d, STYLE[st].bpm)}`, negativeTags: NEG, duration: d }),
  // explicit length language in style
  bars: (st, d) => ({ instrumental: true, style: `${STYLE[st].s}, ${STYLE[st].bpm} BPM, short ${d}-second cue, ${bars(d, STYLE[st].bpm)} bars total, intro then theme then outro, ends on a final chord, instrumental`, prompt: '', duration: d }),
}

async function run(strat, st, d) {
  const id = `${strat}_${st}_${d}`
  const body = { customMode: true, model: 'V6', title: `${st} ${d}s`, callBackUrl: 'https://makaron.app/api/noop', ...STRATS[strat](st, d) }
  const t0 = Date.now()
  const sub = await fetch(`${BASE}/generate`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(r => r.json())
  if (sub.code !== 200) return { id, error: JSON.stringify(sub).slice(0, 200) }
  const taskId = sub.data.taskId
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const rec = await fetch(`${BASE}/generate/record-info?taskId=${taskId}`, { headers: H }).then(r => r.json()).catch(() => null)
    const data = rec?.data
    if (!data) continue
    if (/FAILED|ERROR|EXCEPTION/.test(data.status)) return { id, taskId, error: data.status + ' ' + (data.errorMessage || '') }
    if (data.status === 'SUCCESS') {
      const takes = data.response.sunoData
      const out = []
      for (const [k, t] of takes.entries()) {
        const f = `raw/${id}_${k + 1}.mp3`
        fs.writeFileSync(f, Buffer.from(await fetch(t.audioUrl).then(r => r.arrayBuffer())))
        out.push({ file: f, duration: t.duration, audioId: t.id })
      }
      return { id, taskId, secs: Math.round((Date.now() - t0) / 1000), body, takes: out }
    }
  }
  return { id, taskId, error: 'timeout' }
}

const jobs = process.argv[2].split(',').map(j => { const [a, b, c] = j.split('_'); return [a, b, Number(c)] })
const results = await Promise.all(jobs.map(j => run(...j).catch(e => ({ id: j.join('_'), error: String(e) }))))
const prev = fs.existsSync('gen.json') ? JSON.parse(fs.readFileSync('gen.json', 'utf8')) : []
const merged = [...prev.filter(p => !results.some(r => r.id === p.id)), ...results]
fs.writeFileSync('gen.json', JSON.stringify(merged, null, 2))
for (const r of results) console.log(r.id.padEnd(20), r.error || r.takes.map(t => t.duration.toFixed(1)).join(' / '), r.secs ? `${r.secs}s` : '')
