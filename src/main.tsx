import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { AppLayout } from './app/AppLayout'
import { LibraryPage } from './features/library/LibraryPage'
import { MetronomePage } from './features/metronome/MetronomePage'
import { PlayPage } from './features/play/PlayPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TunerPage } from './features/tuner/TunerPage'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'tuner', element: <TunerPage /> },
      { path: 'metronome', element: <MetronomePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '/play/:songId', element: <PlayPage /> },
])

// Offline support + installability; updates apply on the next launch.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
