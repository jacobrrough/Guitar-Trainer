import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { voiceEnabled } from '../../app/features'
import { Button, Card, PageHeader } from '../../components/ui'
import type { VoiceRange } from '../../training/types'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { voiceDetector } from '../play/voice/judge'
import { EasyNotes, VoiceMic } from './PitchLadder'
import { RangeFinder } from './RangeFinder'
import { RANGE_COPY, voiceLine } from './rangeFinder'

/** The easy notes on their ladder, with the singer's own note on it while the microphone listens. */
function MyNotes({ range, onFind }: { range: VoiceRange; onFind: () => void }) {
  return (
    <Card className="py-6">
      <VoiceMic detector={voiceDetector(range)} ears="voice">
        {(mic) => (
          <EasyNotes range={range} dot={mic.dot}>
            {mic.listening ? (
              <>
                <p className="max-w-sm text-sm text-slate-200" aria-live="polite" data-testid="range-voice-line">
                  {voiceLine(mic.dot, range)}
                </p>
                <Button onClick={mic.stop} data-testid="range-stop">
                  {RANGE_COPY.page.stop}
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={mic.starting} onClick={() => void mic.start()} data-testid="range-see">
                {RANGE_COPY.page.see}
              </Button>
            )}
            {mic.failed && (
              <p role="alert" className="max-w-sm text-sm text-red-300">
                {RANGE_COPY.page.micTrouble}
              </p>
            )}
            <Button onClick={onFind} data-testid="range-find-again">
              {RANGE_COPY.findAgain}
            </Button>
          </EasyNotes>
        )}
      </VoiceMic>
    </Card>
  )
}

/**
 * "My voice": the singer's easy notes, a way to see their own note against them, to move them a little
 * and to find them again. Everything works without a microphone except seeing one's own note: with no
 * easy notes yet, or no permission, the range finder offers its two starting ranges.
 *
 * Whatever is saved here goes through `saveVoiceRange` (in the range finder and in the two "a bit"
 * buttons), and the page shows what the singing profile holds, not what it sent.
 */
export function RangePage() {
  const voice = useLiveQuery(loadVoiceProfile)
  /** 'first': shown because there are no easy notes yet. 'again': the singer asked to find them again. */
  const [finder, setFinder] = useState<'closed' | 'first' | 'again'>('closed')
  const range = voice?.range
  // Without easy notes the finder opens by itself, and it stays open until the singer has seen its result:
  // the range is stored the moment it is found, and going by "is there a range" alone would take the
  // result away from under them.
  if (voice && !range && finder === 'closed') setFinder('first')
  // The singing side stays out of sight until it is switched on.
  if (!voiceEnabled()) return <Navigate to="/" replace />
  return (
    <div data-testid="range-page">
      <PageHeader title={RANGE_COPY.page.title} subtitle={range ? RANGE_COPY.page.about : voice ? RANGE_COPY.page.none : undefined} />
      {/* Nothing is drawn while the profile is being read: the finder must not flash up for a singer who has a range. */}
      {voice &&
        (finder !== 'closed' || !range ? (
          // Asked for by a tap, the microphone may open without another one. On a first visit it waits for "Start".
          <RangeFinder autoStart={finder === 'again'} onDone={() => setFinder('closed')} onSkip={range && finder === 'again' ? () => setFinder('closed') : undefined} />
        ) : (
          <MyNotes range={range} onFind={() => setFinder('again')} />
        ))}
      <p className="mx-auto mt-4 max-w-md text-center text-sm text-muted" data-testid="range-care">
        {RANGE_COPY.hurt}
      </p>
    </div>
  )
}
