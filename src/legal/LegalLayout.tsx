import { Link, useLocation } from 'react-router-dom'
import { LAST_UPDATED } from './version'
import AppLogo from '../components/AppLogo'
import AppBackground from '../components/AppBackground'

interface NavItem {
  to: string
  label: string
}

const NAV: NavItem[] = [
  { to: '/legal/terms', label: 'Terms of Service' },
  { to: '/legal/privacy', label: 'Privacy Policy' },
  { to: '/legal/aup', label: 'Acceptable Use Policy' },
  { to: '/legal/dmca', label: 'DMCA / Copyright' },
]

interface LegalLayoutProps {
  title: string
  children: React.ReactNode
}

export default function LegalLayout({ title, children }: LegalLayoutProps) {
  const { pathname } = useLocation()

  // h-dvh + overflow-y-auto on the root because index.css pins
  // html/body/#root to overflow: hidden; without this the legal pages
  // can't scroll. dvh, not screen: 100vh overflows behind a mobile browser's
  // URL bar, which is the same reason the workspace shell uses it.
  return (
    <div className="relative h-dvh w-full overflow-y-auto bg-surface-0 text-ink-200 antialiased">
      <AppBackground />

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between gap-4 border-b border-ink/5 pb-6">
          <Link to="/" className="flex items-center gap-2.5 text-ink-200 transition-opacity hover:opacity-80">
            <AppLogo className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight">UGC OS</span>
          </Link>
          <Link to="/" className="text-[12px] text-ink-500 transition-colors hover:text-ink-200">
            ← Back to app
          </Link>
        </header>

        <div className="grid gap-10 md:grid-cols-[200px_minmax(0,1fr)]">
          {/* Sidebar TOC */}
          <nav className="space-y-1 md:sticky md:top-6 md:self-start">
            <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-ink-500">
              Legal
            </div>
            {NAV.map((item) => {
              const active = pathname === item.to
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`block rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                    active
                      ? 'bg-ink/[0.06] font-medium text-ink'
                      : 'text-ink-400 hover:bg-ink/[0.03] hover:text-ink-200'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Body */}
          <article className="min-w-0">
            <div className="mb-6 space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
              <p className="text-[12px] text-ink-500">Last updated {LAST_UPDATED}</p>
            </div>

            <div className="prose-legal space-y-5 text-[14px] leading-relaxed text-ink-300">
              {children}
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}

// Tiny helpers so the doc pages stay readable.
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-2 text-xl font-semibold tracking-tight text-ink-100">{children}</h2>
}
export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-[15px] font-semibold tracking-tight text-ink-100">{children}</h3>
}
export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-300">{children}</p>
}
export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="ml-5 list-disc space-y-1 marker:text-ink-600">{children}</ul>
}
