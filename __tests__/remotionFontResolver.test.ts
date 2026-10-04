import { describe, expect, it } from 'vitest';
import { discoverGoogleFontFamilies } from '@/lib/remotion-font-resolver';

describe('Remotion Google Font discovery', () => {
  it('finds arbitrary Google Fonts in direct fontFamily declarations', () => {
    expect(discoverGoogleFontFamilies({
      code: `const title = <div style={{fontFamily: 'Bungee Spice, sans-serif'}}>HELLO</div>;`,
    })).toContain('Bungee Spice');
  });

  it('finds arbitrary Google Fonts passed through persisted props and substitutions', () => {
    const families = discoverGoogleFontFamilies({
      code: `const title = <Title font={props.headingFont} />;`,
      props: { headingFont: 'Cormorant Garamond' },
      substitutions: { Didot: 'Kablammo' },
    });

    expect(families).toEqual(expect.arrayContaining(['Cormorant Garamond', 'Kablammo']));
  });

  it('does not treat local system fonts as Google Fonts', () => {
    expect(discoverGoogleFontFamilies({
      code: `const title = <div style={{fontFamily: 'STKaiti, serif'}}>标题</div>;`,
    })).not.toContain('STKaiti');
  });
});
