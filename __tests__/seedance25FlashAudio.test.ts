import {afterEach,expect,it,vi} from 'vitest'
const {read}=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('@/lib/provider-image-preflight',()=>({readProviderImage:read}))
import {validateFlashAudioReferences} from '@/lib/seedance25-flash-preflight'
function wav(seconds:number){const data=8000*2*seconds,b=Buffer.alloc(44+data);b.write('RIFF');b.writeUInt32LE(36+data,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(data,40);return b}
afterEach(()=>vi.unstubAllGlobals())
it('measures the combined audio duration, including URLs, before provider submission',async()=>{
 const bytes=wav(16)
 read.mockResolvedValue(bytes)
 await expect(validateFlashAudioReferences(['https://example.com/a.wav'])).resolves.toBeUndefined()
 await expect(validateFlashAudioReferences(['https://example.com/a.wav','https://example.com/b.wav'])).rejects.toThrow('30 seconds')
})
