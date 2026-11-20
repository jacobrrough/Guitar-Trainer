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
import { audioEngine } from './audio/AudioEngine'
import { metronome } from './audio/metronome/Metronome'
import { LibraryPage } from './features/library/LibraryPage'
import { MetronomePage } from './features/metronome/MetronomePage'
import { PlayPage } from './features/play/PlayPage'
import { ProgressPage } from './features/progress/ProgressPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TestFlow } from './features/test/TestFlow'
import { BlockRunner } from './features/today/BlockRunner'
import { TodayPage } from './features/today/TodayPage'
import { TunerPage } from './features/tuner/TunerPage'

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
    ],
  },
  { path: '/play/:songId', element: <PlayPage /> },
  { path: '/start', element: <StartHere /> },
  { path: '/lessons/:lessonId', element: <LessonPage /> },
  { path: '/today/block/:blockId', element: <BlockRunner /> },
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
