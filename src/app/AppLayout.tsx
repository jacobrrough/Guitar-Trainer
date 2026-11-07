import { Activity, ListMusic, Settings, Timer } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { cx } from '../components/ui'

const NAV = [
  { to: '/', label: 'Songs', icon: ListMusic, end: true },
  { to: '/tuner', label: 'Tuner', icon: Activity, end: false },
  { to: '/metronome', label: 'Metronome', icon: Timer, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">Guitar Trainer</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent/15 text-amber-200' : 'text-slate-300 hover:bg-panel-2 hover:text-slate-100',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-2 text-xs text-muted">Free &amp; open source. Everything runs in your browser.</p>
      </aside>
      <main className="flex-1 overflow-y-auto px-4 pb-24 pt-6 short-landscape:pb-16 short-landscape:pt-3 md:px-8 md:pb-8">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel/95 backdrop-blur md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx('flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium short-landscape:py-1.5', isActive ? 'text-amber-200' : 'text-slate-400')
            }
          >
            <Icon className="h-5 w-5" />
            <span className="short-landscape:hidden">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
