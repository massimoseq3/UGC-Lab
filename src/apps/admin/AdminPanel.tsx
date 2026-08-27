import { useState } from 'react'
import { Shield } from 'lucide-react'
import MembersTable from './MembersTable'
import AllowlistEditor from './AllowlistEditor'
import Insights from './Insights'
import Announcements from './Announcements'
import { useAuthStore } from '../../stores/authStore'

type Tab = 'members' | 'insights' | 'announcements' | 'allowlist'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'members', label: 'Members' },
  { id: 'insights', label: 'Insights' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'allowlist', label: 'Allowlist' },
]

export default function AdminPanel() {
  const isAdmin = useAuthStore((s) => s.profile?.is_admin === true)
  const [tab, setTab] = useState<Tab>('members')
  // A tab is mounted on first visit and then STAYS mounted, hidden behind the
  // active one. Unmounting used to throw away each pane's fetched data, sort,
  // filters and scroll position, so every click on the tab strip dropped the
  // panel back to a spinner and refired its queries.
  const [visited, setVisited] = useState<Tab[]>(['members'])

  function open(next: Tab) {
    setTab(next)
    setVisited((prev) => (prev.includes(next) ? prev : [...prev, next]))
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-500">
        <Shield className="h-8 w-8" />
        <span className="text-sm">Admin only.</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* On a phone the four tabs alone are wider than the screen, so the title
          keeps the first row and the strip takes its own, scrolling sideways
          rather than wrapping into a two-row slab. The strip never scrolls
          AWAY: it's how you reach the other three panes. */}
      <header className="flex items-center justify-between gap-4 border-b border-ink/5 px-6 py-4 max-md:px-4 max-md:py-2.5">
        {/* The title row is `md`-only: the menu bar already reads "UGC OS /
            Admin", and a phone can't spend 48px of pinned chrome saying it
            twice above four tabs it also has to keep on screen. */}
        <div className="flex items-center gap-2 max-md:hidden">
          <Shield className="h-5 w-5 text-ink-300" />
          <h1 className="text-lg font-semibold tracking-tight text-ink-100">Admin</h1>
        </div>
        <div className="flex gap-1 overflow-x-auto scrollbar-hide rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 max-md:w-full md:overflow-visible">
          {TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} onClick={() => open(t.id)}>{t.label}</TabButton>
          ))}
        </div>
      </header>

      {/* Each pane owns its own scroll container so a hidden tab keeps its
          scroll position instead of inheriting the last one's. */}
      <div className="relative flex-1">
        {TABS.filter((t) => visited.includes(t.id)).map((t) => (
          <div
            key={t.id}
            className={`absolute inset-0 overflow-y-auto px-6 py-5 max-md:px-4 max-md:py-4 ${tab === t.id ? '' : 'hidden'}`}
          >
            {t.id === 'members' ? (
              <MembersTable />
            ) : t.id === 'insights' ? (
              <Insights />
            ) : t.id === 'announcements' ? (
              <Announcements />
            ) : (
              <AllowlistEditor />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors md:py-1 ${
        active ? 'bg-ink/10 text-ink-100' : 'text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  )
}
