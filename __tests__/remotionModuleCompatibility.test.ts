import { describe, expect, it } from 'vitest'
import { evalRemotionJSX } from '@/lib/evalRemotionJSX'

describe('natural Remotion module compatibility', () => {
  it('evaluates a default Remotion namespace import', () => {
    const component = evalRemotionJSX(`
      import Remotion from 'remotion';
      export default function Composition() {
        return <Remotion.AbsoluteFill />;
      }
    `)

    expect(component).toBeTypeOf('function')
  })

  it('evaluates named ESM imports and CommonJS exports', () => {
    const esm = evalRemotionJSX(`
      import {AbsoluteFill} from 'remotion';
      export const Composition = () => <AbsoluteFill />;
    `)
    const commonJs = evalRemotionJSX(`
      const {AbsoluteFill} = require('remotion');
      module.exports = () => <AbsoluteFill />;
    `)

    expect(esm).toBeTypeOf('function')
    expect(commonJs).toBeTypeOf('function')
  })
})
