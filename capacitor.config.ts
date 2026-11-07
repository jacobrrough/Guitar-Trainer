import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native wrapper configuration (see docs/IOS.md). The web app itself is the
 * product; Capacitor only packages `dist/` into an iOS project so it can be
 * installed from Xcode or shipped through TestFlight / the App Store.
 */
const config: CapacitorConfig = {
  appId: 'app.guitartrainer',
  appName: 'Guitar Trainer',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0b0f17',
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
  },
}

export default config
