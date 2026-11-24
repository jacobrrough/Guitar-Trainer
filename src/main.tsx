import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { CoursePage } from './features/lessons/CoursePage'
import { LessonPage } from './features/lessons/LessonPage'
import { StartHere } from './features/onboarding/StartHere'
import { GuidedTunerPage } from './features/tuner/GuidedTuner'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { AppLayout } from './app/AppLayout'
import { connectUpdates } from './app/appUpdate'
import { voiceEnabled } from './app/features'
import { audioEngine } from './audio/AudioEngine'
import { metronome } from './audio/metronome/Metronome'
import { VoiceCheckPage } from './features/dev/VoiceCheckPage'
import { LibraryPage } from './features/library/LibraryPage'
import { MetronomePage } from './features/metronome/MetronomePage'
import { PlayPage } from './features/play/PlayPage'
import { ProgressPage } from './features/progress/ProgressPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SingPage } from './features/sing/SingPage'
import { TestFlow } from './features/test/TestFlow'
import { BlockRunner } from './features/today/BlockRunner'
import { TodayPage } from './features/today/TodayPage'
import { TunerPage } from './features/tuner/TunerPage'
import { RangePage } from './features/voice/RangePage'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'songs', element: <LibraryPage /> },
      { path: 'progress', element: <ProgressPage /> },
      { path: 'tuner', element: <TunerPage /> },
      { path: 'metronome', element: <MetronomePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'test/:type', element: <TestFlow /> },
      { path: 'lessons', element: <CoursePage /> },
      { path: 'tune', element: <GuidedTunerPage /> },
      // "My voice": a singer's easy notes. The page goes home by itself while the singing side is switched off.
      { path: 'range', element: <RangePage /> },
    ],
  },
  { path: '/play/:songId', element: <PlayPage /> },
  // A song to sing. It goes home by itself while the singing side is switched off, as "My voice" does.
  { path: '/sing/:songId', element: <SingPage /> },
  // The set-up, for the guitar; with `?instrument=voice` and the singing side switched on, for a singer.
  { path: '/start', element: <StartHere /> },
  { path: '/lessons/:lessonId', element: <LessonPage /> },
  { path: '/today/block/:blockId', element: <BlockRunner /> },
  // A hidden check of the singing side: one sung exercise in the real player. The address is only
  // there while the voice side is switched on; otherwise it is an address that does not exist.
  ...(voiceEnabled() ? [{ path: '/voice-check', element: <VoiceCheckPage /> }] : []),
])

// Offline support + installability. A new version is switched to at launch or on request (see appUpdate).
connectUpdates(
  (callbacks) => registerSW({ immediate: true, ...callbacks }),
  () => audioEngine.micActive || metronome.running,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
