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
      <header className="flex items-center justify-between border-b border-ink/5 px-6 py-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-ink-300" />
          <h1 className="text-lg font-semibold tracking-tight text-ink-100">Admin</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5">
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
            className={`absolute inset-0 overflow-y-auto px-6 py-5 ${tab === t.id ? '' : 'hidden'}`}
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
      className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
        active ? 'bg-ink/10 text-ink-100' : 'text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  )
}
