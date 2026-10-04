import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { isIsolatedMakaronE2E } from '@/lib/e2e-runtime'

export async function GET() {
  if (!isIsolatedMakaronE2E()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const zip = new JSZip()
  zip.file('SKILL.md', `---
name: e2e-ending-spirit
description: Deterministic fixture used only by the isolated iOS subscription E2E suite.
allowed-tools: generate_image
metadata:
  makaron:
    icon: "sparkles"
    color: "#f05bec"
    tipsEnabled: false
    sourceMediaRequired: true
---

# E2E Ending Spirit

Use the supplied image as the source and preserve the user's identity. The
fixture validates that the selected Skill and uploaded image survive the
subscribe-before-register continuation into the editor.
`)
  const archive = await zip.generateAsync({ type: 'arraybuffer' })
  return new NextResponse(archive, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'inline; filename="e2e-ending-spirit.zip"',
      'Cache-Control': 'no-store',
    },
  })
}
