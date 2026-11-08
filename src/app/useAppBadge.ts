import { useEffect } from 'react'
import { setAppBadge } from './badge'

/** Shows an app icon badge of 1 while `pending` is true; clears it otherwise and on unmount. */
export function useAppBadge(pending: boolean): void {
  useEffect(() => {
    void setAppBadge(pending ? 1 : null)
  }, [pending])
  useEffect(() => () => void setAppBadge(null), [])
}
