import { useState } from 'react'

/**
 * Returns `value`, except while `hold` is true: then it keeps returning the value from before the
 * hold began. Used to keep a live database record from swapping the chart and audio under a run in
 * progress (a refresh would restart the score and reload the sound mid-song).
 */
export function useHeld<T>(value: T, hold: boolean): T {
  const [held, setHeld] = useState(value)
  if (!hold && held !== value) {
    // Adopting the new value during render is React's pattern for state derived from props.
    setHeld(value)
    return value
  }
  return hold ? held : value
}
