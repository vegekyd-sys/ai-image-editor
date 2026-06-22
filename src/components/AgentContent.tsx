'use client'

import AgentCopyButton from './AgentCopyButton'

const INSTALL_SKILL_COMMAND = 'npx makaron-cli setup'

export default function AgentContent() {
  return (
    <div className="min-h-screen w-full bg-black text-gray-200 font-mono p-6 md:p-12 max-w-4xl mx-auto overflow-hidden">
      <header className="flex items-center gap-2 mb-12">
        <h1 className="text-2xl font-bold text-white">makaron<span className="text-fuchsia-400">-cli</span></h1>
        <AgentCopyButton />
      </header>


      {/* Hero */}
      <section className="mb-12">
        <p className="text-lg text-white mb-2">
          <span className="text-fuchsia-400">makaron.app</span> is for humans.{' '}
          <span className="text-fuchsia-400">makaron-cli</span> is for AI agents.
        </p>
        <p className="text-sm text-gray-400">
          Makaron is a multimodal AI creative agent. You talk to it via <code className="text-fuchsia-300">makaron chat</code>, and it produces images, videos, music, and animated designs — all saved to a persistent project.
        </p>
      </section>

      {/* Install */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Install</h2>
        <p className="text-sm text-gray-400 mb-4">
          Ask your agent to install <code className="text-fuchsia-300">makaron-cli</code> globally and add the Makaron Agent Skill.
        </p>
        <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-between gap-3">
          <code className="min-w-0 text-sm text-gray-200 overflow-x-auto whitespace-pre">{INSTALL_SKILL_COMMAND}</code>
          <button
            onClick={() => { navigator.clipboard?.writeText(INSTALL_SKILL_COMMAND).catch(() => {}); }}
            className="shrink-0 px-3 py-1.5 rounded-md border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            Copy
          </button>
        </div>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto mt-4">
{`export MAKARON_API_KEY=mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx makaron-cli list   # verify it works`}
        </pre>
      </section>

      {/* Core Workflow */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Core Workflow</h2>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`# One-shot: create project + upload image + submit prompt — all in one command
RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic and create a 5s video")

# Watch until all artifacts are ready
npx makaron-cli responses watch $RUN_ID --jsonl`}
        </pre>
        <p className="text-xs text-gray-500 mt-2">Or with an existing project:</p>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto mt-2">
{`RUN_ID=$(npx makaron-cli chat --project $PROJECT_ID -b "make a 5s video")
npx makaron-cli responses watch $RUN_ID --jsonl`}
        </pre>
      </section>

      {/* Chat Command */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">chat — Primary Command</h2>
        <p className="text-sm text-gray-400 mb-4">
          Use <code className="text-fuchsia-300">chat</code> for all creative tasks. The Agent decides how to execute — it can edit images, generate videos, compose music, and create designs in a single conversation.
        </p>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`# Submit (returns immediately with runId)
npx makaron-cli chat --project <id> --json -b "<prompt>"

# Auto-create project with images
npx makaron-cli chat --project auto --image photo.jpg --json -b "make it cinematic"
npx makaron-cli chat --project auto --image img1.jpg --image img2.jpg --json -b "combine these"

# Add reference images to existing project
npx makaron-cli chat --project <id> --image ref.jpg -b "use this style"`}
        </pre>
      </section>

      {/* Responses */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">responses — Track Results</h2>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`# Check status (single query)
npx makaron-cli responses get <runId> --json

# Watch until done (streaming events)
npx makaron-cli responses watch <runId> --jsonl

# Extract specific results
npx makaron-cli responses get <runId> --pick first_image_url
npx makaron-cli responses get <runId> --pick first_video_url
npx makaron-cli responses get <runId> --pick text
npx makaron-cli responses get <runId> --pick status`}
        </pre>
        <p className="text-xs text-gray-500 mt-2">Watch outputs one JSON per line as artifacts appear:</p>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto mt-2">
{`{"event":"output.added","item":{"type":"image","status":"completed","url":"https://..."}}
{"event":"output.added","item":{"type":"video","status":"rendering","task_id":"xxx"}}
{"event":"output.updated","item":{"type":"video","status":"completed","url":"https://..."}}
{"event":"done","status":"completed"}`}
        </pre>
      </section>

      {/* Capabilities */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Capabilities</h2>
        <div className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
          <table className="w-full">
            <tbody className="divide-y divide-gray-800">
              {[
                ['Edit photo', '"make it cinematic with warm tones"'],
                ['Style transfer', '"convert to oil painting style"'],
                ['Add/remove elements', '"add a cat on the table" / "remove background"'],
                ['Text-to-image', '"generate a cyberpunk cityscape"'],
                ['Video from image', '"create a 5 second video of her walking"'],
                ['Video with model', '"use seedance model, make a 5s video"'],
                ['Background music', '"add calm piano music"'],
                ['Motion design', '"create an Instagram story with animated text"'],
                ['Multi-step', '"edit the photo then make a video from it"'],
              ].map(([cap, example]) => (
                <tr key={cap}>
                  <td className="py-1.5 pr-4 text-gray-300 whitespace-nowrap">{cap}</td>
                  <td className="py-1.5 text-gray-500">{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Fallback Tools */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Fallback: Direct Tool Calls</h2>
        <p className="text-sm text-gray-400 mb-4">
          Use only when <code className="text-fuchsia-300">chat</code> is unavailable or you need raw model access without project context.
        </p>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`# edit — One-shot image editing
npx makaron-cli edit --image photo.jpg "add cinematic warm lighting"
npx makaron-cli edit "a cyberpunk cityscape at night"   # text-to-image
npx makaron-cli edit --image photo.jpg --model openai --out result.jpg "make it dramatic"

# video — Video generation
npx makaron-cli video script --image img1.jpg "cinematic story"
npx makaron-cli video create --script "..." --image https://...jpg --duration 5
npx makaron-cli video status <taskId>

# music — Music generation
npx makaron-cli music create "gentle piano, warm strings, cinematic"
npx makaron-cli music status <taskId>`}
        </pre>
      </section>

      {/* Important Notes */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Important Notes</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
          <li>One project = one conversation thread. All history preserved.</li>
          <li>Most videos take 3-5 minutes; Grok is usually around 30-40 seconds. Use <code className="text-fuchsia-300">watch</code> to get URL when ready.</li>
          <li>Music takes ~60 seconds. Images typically 15-30 seconds.</li>
          <li>Always use <code className="text-fuchsia-300">chat</code> as primary interface — even for single edits.</li>
          <li>stdout = machine-readable JSON/text. Human-friendly logs → stderr.</li>
        </ul>
      </section>

      {/* Self-Registration */}
      <section className="mb-12 border-t border-gray-800 pt-12">
        <h2 className="text-lg text-fuchsia-400 mb-2">Self-Registration (No Human Required)</h2>
        <p className="text-sm text-gray-400 mb-6">
          AI agents can register themselves to get an API key and welcome credits. No email or password needed.
        </p>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm text-gray-400 mb-2">Step 1: Get Challenge</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`npx makaron-cli register --json
→ { "challenge_id": "...", "challenge": "...", "expected_format": "numeric, round to 2 decimal places" }`}
            </pre>
          </div>

          <div>
            <h3 className="text-sm text-gray-400 mb-2">Step 2: Solve & Verify</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`npx makaron-cli register --verify --challenge-id <id> --answer 34.5
→ Key saved to ~/.makaron/auth.json
→ { "api_key": "mk_live_...", "credits": N, "claim_url": "..." }`}
            </pre>
          </div>

          <div>
            <h3 className="text-sm text-gray-400 mb-2">Step 3: Start using the CLI</h3>
            <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic"
npx makaron-cli responses watch <runId> --jsonl`}
            </pre>
          </div>
        </div>
      </section>

      {/* Claim */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Let a Human Claim This Account</h2>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`npx makaron-cli claim
→ { "claim_url": "https://www.makaron.app/claim?token=clm_..." }

Share claim_url with a human. They log in and link the API key to your account.`}
        </pre>
      </section>

      {/* Billing */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Billing</h2>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
          <li>welcome credits on registration</li>
          <li>Credits consumed per operation (varies by tool)</li>
          <li>Top up: <span className="text-fuchsia-300">https://www.makaron.app/dashboard</span></li>
        </ul>
      </section>

      {/* Discovery */}
      <section className="mb-12">
        <h2 className="text-lg text-fuchsia-400 mb-4">Discovery API</h2>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
{`GET https://www.makaron.app/api/agent/register
→ JSON with full registration flow, CLI commands, and capabilities`}
        </pre>
      </section>

      <footer className="border-t border-gray-800 pt-6 pb-16 text-sm text-gray-500">
        <p>Makaron AI — One Man Studio</p>
      </footer>
    </div>
  )
}
