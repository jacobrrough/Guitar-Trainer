import { Download, Share, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui'
import { iosBrowser, isIOS, isStandalone } from './platform'

const DISMISS_KEY = 'guitar-trainer.install-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * iOS has no install prompt, so we explain Share → Add to Home Screen.
 * Chromium browsers get a real install button via `beforeinstallprompt`.
 */
export function InstallBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (dismissed || isStandalone()) return null
  const ios = isIOS()
  if (!ios && !promptEvent) return null
  const browser = ios ? iosBrowser() : 'safari'
  const device = ios && /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone'

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm" data-testid="install-banner">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" className="h-10 w-10 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Install Guitar Trainer on this {ios ? device : 'device'}</p>
        {ios ? (
          <p className="mt-1 text-muted">
            {browser === 'webview' ? (
              <>This in-app browser cannot install apps. Open this page in Safari, then use Share → Add to Home Screen.</>
            ) : (
              <>
                Tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> <strong>Share</strong> (or <strong>•••</strong> on newer iOS), then{' '}
                <strong>Add to Home Screen</strong>
                {browser === 'browser' ? ' (works in this browser on iOS 16.4+, Safari is the most reliable)' : ''}. You get a full-screen app, offline use and your
                songs stay saved.
              </>
            )}
          </p>
        ) : (
          <p className="mt-1 text-muted">Runs full screen and works offline.</p>
        )}
        {!ios && promptEvent && (
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            onClick={async () => {
              await promptEvent.prompt()
              const choice = await promptEvent.userChoice
              if (choice.outcome === 'accepted') dismiss()
              setPromptEvent(null)
            }}
          >
            <Download className="h-4 w-4" /> Install
          </Button>
        )}
      </div>
      <button type="button" onClick={dismiss} className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-slate-100" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
