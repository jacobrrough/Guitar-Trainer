/**
 * Test helper: decodes the shipped sample pack in Node, so unit tests run the sampler and the
 * scoring simulation on the real recordings. Not part of the app bundle.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MPEGDecoder } from 'mpg123-decoder'
import { GUITAR_PACK, buildBank, type SampleBank } from './bank'

let cached: Promise<SampleBank> | null = null

export function loadRealBank(): Promise<SampleBank> {
  cached ??= (async () => {
    const file = path.resolve(import.meta.dirname, '../../../public', GUITAR_PACK.file)
    const decoder = new MPEGDecoder()
    await decoder.ready
    const decoded = decoder.decode(new Uint8Array(readFileSync(file)))
    decoder.free()
    return buildBank(GUITAR_PACK, decoded.channelData[0], decoded.sampleRate)
  })()
  return cached
}
