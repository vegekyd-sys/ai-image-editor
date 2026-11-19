// Gemini listens to each fitted track on its own (3 rounds, averaged).
import fs from 'node:fs'
const env = fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.local', 'utf8')
const GKEY = env.match(/^GOOGLE_API_KEY=["']?([^"'\n]+)/m)[1].trim()
const files = process.argv.slice(2)
const PROMPT = (secs) => `You are a senior music editor for short-form video. This instrumental background track must be exactly ${secs} seconds and will sit under a video. Listen to the WHOLE track, especially the last 10 seconds. Score 1-10:
- ending: 10 = composed musical ending that resolves (final chord/hit/decay), 6 = acceptable smooth fade-out, 3 = fade that clearly chops a phrase mid-way, 1 = abrupt cut.
- seamless: 10 = no audible edit; lower if you hear a jump, skipped beat, repeated/doubled hit, rhythm stumble, sudden change of section that sounds edited, or tempo/pitch warble. Give the timestamp of any such problem.
- audio_quality, musicality, usability_as_bgm.
Be strict and use the full scale. JSON only: {"ending":n,"seamless":n,"audio_quality":n,"musicality":n,"usability_as_bgm":n,"edit_glitch_at":"mm:ss or none","notes":"<=25 words"}`

async function judge(f) {
  const secs = Number(f.match(/_(\d+)(?:_\d)?(?:_(?:fade|splice))?\.mp3$/)[1])
  const audio = fs.readFileSync(f).toString('base64')
  const rounds = []
  for (let r = 0; r < 3; r++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GKEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT(secs) }, { inlineData: { mimeType: 'audio/mp3', data: audio } }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
      }).then(r => r.json())
      const text = res.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')
      if (text) { let j = JSON.parse(text); if (Array.isArray(j)) j = j[0]; if (typeof j?.ending === 'number') rounds.push(j); else console.error(f, 'shape', text.slice(0, 150)) } else console.error(f, JSON.stringify(res).slice(0, 200))
    } catch (e) { console.error(f, String(e)) }
  }
  const avg = k => rounds.length ? +(rounds.reduce((s, x) => s + x[k], 0) / rounds.length).toFixed(1) : null
  return { file: f, n: rounds.length, ending: avg('ending'), seamless: avg('seamless'), q: avg('audio_quality'), mus: avg('musicality'), use: avg('usability_as_bgm'), glitch: rounds.map(x => x.edit_glitch_at), notes: rounds.map(x => x.notes) }
}
const out = []
for (let i = 0; i < files.length; i += 6) out.push(...await Promise.all(files.slice(i, i + 6).map(judge)))
const prev = fs.existsSync('judge.json') ? JSON.parse(fs.readFileSync('judge.json', 'utf8')) : []
fs.writeFileSync('judge.json', JSON.stringify([...prev.filter(p => !out.some(o => o.file === p.file)), ...out], null, 2))
for (const o of out) console.log(o.file.padEnd(36), `n${o.n} end ${o.ending} seam ${o.seamless} q ${o.q} mus ${o.mus} use ${o.use} glitch ${o.glitch.join(',')}`)
