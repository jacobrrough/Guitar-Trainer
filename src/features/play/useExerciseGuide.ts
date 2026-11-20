import { useEffect, useState } from 'react'
import { encodeWav } from '../../audio/synth'
import { renderExerciseGuide } from '../../training/exercises/backing'
import type { GeneratedExercise } from '../../training/types'

/**
 * The listening guide for an exercise (the part played on the guitar over the click), rendered in
 * the background. `ready` turns true once the guide exists or it is clear there will be none, so a
 * page can wait for it before showing the player.
 */
export function useExerciseGuide(exercise: GeneratedExercise | null): { guide: Blob | null; ready: boolean } {
  const [rendered, setRendered] = useState<{ exercise: GeneratedExercise; guide: Blob | null } | null>(null)
  const wanted = !!exercise?.wantsGuide
  useEffect(() => {
    if (!exercise || !wanted) return
    let cancelled = false
    renderExerciseGuide(exercise)
      .then((pcm) => {
        if (!cancelled) setRendered({ exercise, guide: encodeWav(pcm, exercise.backingSampleRate) })
      })
      .catch(() => {
        if (!cancelled) setRendered({ exercise, guide: null })
      })
    return () => {
      cancelled = true
    }
  }, [exercise, wanted])
  if (!exercise || !wanted) return { guide: null, ready: true }
  const ready = rendered?.exercise === exercise
  return { guide: ready ? rendered.guide : null, ready }
}
