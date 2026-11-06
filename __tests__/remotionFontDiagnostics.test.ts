import { describe, expect, it } from 'vitest';
import { remotionFontWarnings, remotionFontWarningText } from '@/lib/remotion-font-diagnostics';

describe('Remotion font diagnostics for Agent tool results', () => {
  it('accepts catalog and on-demand Google Font stacks kept in constants', () => {
    expect(remotionFontWarnings({
      code: `
        const SERIF = "'Noto Serif SC', serif";
        const DISPLAY = "'Lobster Two', cursive";
        function Composition() {
          return <><div style={{fontFamily: SERIF}}>生日快乐</div><div style={{fontFamily: DISPLAY}}>Hi</div></>;
        }
      `,
    })).toEqual([]);
  });

  it('explains an unpinned runtime family next to the draft', () => {
    const text = remotionFontWarningText({
      code: `
        const KAI = 'STKaiti';
        function Composition() { return <div style={{fontFamily: KAI}}>微信华章</div>; }
      `,
    });

    expect(text).toContain('Font check');
    expect(text).toContain('fontFamily: KAI resolves to "STKaiti"');
    expect(text).toContain('Chinese/Japanese/Korean text renders blank');
  });

  it('surfaces a rejected inline system font before preview_frame', () => {
    expect(remotionFontWarnings({
      code: `function Composition() { return <div style={{fontFamily: 'STKaiti, serif'}}>中</div>; }`,
    })).toEqual([expect.stringContaining('Unsupported Remotion font "STKaiti"')]);
  });

  it('stays silent for a composition without code', () => {
    expect(remotionFontWarningText({ code: '' })).toBe('');
  });
});
