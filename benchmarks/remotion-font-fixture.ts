import type { DesignPayload } from '@/types'

export const FONT_PARITY_DESIGN: DesignPayload = {
  width: 720,
  height: 720,
  animation: { fps: 30, durationInSeconds: 2 },
  props: {},
  code: `function Design() {
  return <AbsoluteFill style={{
    background: '#111827', color: 'white', padding: 64,
    justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  }}>
    <div style={{fontFamily: 'Playfair Display, serif', fontWeight: 700, fontSize: 72}}>Google Fonts</div>
    <div style={{fontFamily: 'ZCOOL KuaiLe, cursive', fontWeight: 400, fontSize: 82, color: '#f0abfc', marginTop: 28}}>中文字体正确</div>
    <div style={{fontWeight: 700, fontSize: 34, marginTop: 36}}>Makaron 中英混排 2026</div>
    <div style={{fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 500, fontSize: 25, color: '#93c5fd', marginTop: 28}}>lambda.fonts.ready()</div>
  </AbsoluteFill>;
}`,
}
