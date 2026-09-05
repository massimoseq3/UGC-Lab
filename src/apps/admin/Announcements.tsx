import { useEffect, useState } from 'react'
import { AlertTriangle, Eye, ImagePlus, Plus, RefreshCw, Siren, Trash2, X } from 'lucide-react'
import Spinner from '../../components/Spinner'
import { useAuthStore } from '../../stores/authStore'
import { APP_REGISTRY } from '../../utils/constants'
import type { Announcement, AnnouncementLevel } from '../../stores/announcementStore'
import { useAnnouncementStore } from '../../stores/announcementStore'
import AnnouncementCard from '../../components/announcements/AnnouncementCard'
import { prepareAnnouncementImage } from '../../components/announcements/media'
import AutoGrowTextarea from '../../components/AutoGrowTextarea'
import Dropdown from '../../components/Dropdown'
import SegmentedToggle from '../../components/SegmentedToggle'
import { useMembers } from './useMembers'
import {
  announcementStatus,
  deleteAnnouncement,
  draftFrom,
  draftToAnnouncement,
  emptyDraft,
  fetchAnnouncementImage,
  fetchReadCounts,
  listAnnouncements,
  saveAnnouncement,
  type AnnouncementDraft,
  type AnnouncementStatus,
} from './adminAnnouncements'

// Admin → Announcements. Write one, see exactly how it will land, then publish.
//
// The preview is not a mock: it renders the same AnnouncementCard the members
// get, from the same draft the save writes. That's the only way a preview stays
// honest as the card changes — and it's why the card takes a `preview` flag
// instead of the editor re-implementing it.

type PublishMode = 'draft' | 'now' | 'schedule'

const STATUS_STYLES: Record<AnnouncementStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-ink/10 text-ink-400' },
  scheduled: { label: 'Scheduled', className: 'bg-sky-500/15 text-sky-300 light:text-sky-700' },
  live: { label: 'Live', className: 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700' },
  expired: { label: 'Expired', className: 'bg-ink/10 text-ink-500' },
}

// datetime-local speaks local wall-clock time; the column is a timestamptz.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : new Date(ts).toISOString()
}

function publishModeOf(d: AnnouncementDraft, now: number): PublishMode {
  if (!d.publishedAt) return 'draft'
  return Date.parse(d.publishedAt) > now ? 'schedule' : 'now'
}

export default function Announcements() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [items, setItems] = useState<Announcement[]>([])
  const [readCounts, setReadCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const { rows: members } = useMembers()
  // Admins are members too, but they're not the audience the receipt is about.
  // Neither is anyone locked out — a lapsed or disabled member never reaches
  // the Dashboard the announcement shows on, so counting them would make the
  // "seen by 38 / 62" receipt permanently short of its own denominator.
  const audience = members.filter((m) => !m.disabled_at && !m.lapsed_at && !m.is_admin).length

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const [list, counts] = await Promise.all([listAnnouncements(), fetchReadCounts().catch(() => ({}))])
      setItems(list)
      setReadCounts(counts)
      setError(null)
    } catch (e) {
      // A failed refresh over loaded rows banners; it never blanks the table.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function edit(a: Announcement): Promise<void> {
    // Open immediately with no image, then fill it in — a 200 KB fetch should
    // not sit between the click and the form.
    setDraft(draftFrom(a, null))
    if (!a.hasImage) return
    try {
      const image = await fetchAnnouncementImage(a.id)
      setDraft((d) => (d && d.id === a.id ? { ...d, image } : d))
    } catch (e) {
      console.warn('[admin] announcement image fetch failed', e)
    }
  }

  async function save(next: AnnouncementDraft): Promise<void> {
    setSaving(true)
    try {
      await saveAnnouncement(next, userId)
      setDraft(null)
      await refresh()
      // The operator is usually their own first reader — pull the member-side
      // store back in line so the Dashboard tile reflects what just published.
      void useAnnouncementStore.getState().load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteAnnouncement(id)
      if (draft?.id === id) setDraft(null)
      await refresh()
      void useAnnouncementStore.getState().load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">Announcements</h2>
          <p className="text-[12px] text-ink-500">
            Broadcast to every member. Alerts open once on their next visit; updates just dot the Dashboard tile.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-full border border-ink/10 px-3 text-[12px] text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100 md:h-8"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          onClick={() => setDraft(emptyDraft())}
          className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-semibold text-paper transition-colors hover:bg-ink/90 md:h-8"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          New
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-ink-500 hover:text-ink-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {draft ? (
        <Editor
          key={draft.id}
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={save}
          saving={saving}
        />
      ) : (
        <AnnouncementList
          items={items}
          loading={loading}
          readCounts={readCounts}
          audience={audience}
          onEdit={edit}
          onDelete={remove}
        />
      )}
    </div>
  )
}

// ── List ───────────────────────────────────────────────────────────────────

function AnnouncementList({
  items,
  loading,
  readCounts,
  audience,
  onEdit,
  onDelete,
}: {
  items: Announcement[]
  loading: boolean
  readCounts: Record<string, number>
  audience: number
  onEdit: (a: Announcement) => void
  onDelete: (id: string) => void
}) {
  // One clock for the whole list, read outside render for the same reason the
  // heatmap does it: Date.now() in a render body is an impure call.
  const [now] = useState(() => Date.now())

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-500">
        <Spinner className="h-4 w-4" />
        Loading announcements…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/10 py-16 text-center">
        <Siren className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
        <p className="text-[13px] text-ink-500">No announcements yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((a) => {
        const status = announcementStatus(a, now)
        const style = STATUS_STYLES[status]
        const seen = readCounts[a.id] ?? 0
        return (
          <div
            key={a.id}
            className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-ink/[0.02] p-3 light:bg-white/60"
          >
            <button onClick={() => onEdit(a)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${style.className}`}>
                  {style.label}
                </span>
                {a.level === 'alert' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-red-300 light:text-red-700">
                    <Siren className="h-3 w-3" strokeWidth={2} />
                    Alert
                  </span>
                )}
                {a.pinned && (
                  <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-400">
                    Pinned
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium text-ink-100">{a.title || 'Untitled'}</p>
              <p className="mt-0.5 truncate text-[11px] text-ink-500">
                {status === 'draft'
                  ? 'Not published'
                  : status === 'scheduled'
                    ? `Publishes ${new Date(a.publishedAt!).toLocaleString()}`
                    : `Published ${new Date(a.publishedAt!).toLocaleDateString()}`}
                {a.expiresAt && ` · hides ${new Date(a.expiresAt).toLocaleDateString()}`}
              </p>
            </button>

            {/* Read receipts — the answer to "does anyone read these?". Only
                meaningful once it's live, so drafts show nothing. */}
            {status !== 'draft' && (
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-[13px] font-semibold tabular-nums text-ink-200">
                  {seen}
                  <span className="text-ink-600">{audience > 0 ? ` / ${audience}` : ''}</span>
                </p>
                <p className="text-[10px] uppercase tracking-[0.06em] text-ink-600">seen</p>
              </div>
            )}

            <DeleteButton onConfirm={() => onDelete(a.id)} />
          </div>
        )
      })}
    </div>
  )
}

// The app's two-click delete idiom: arms into a red Confirm pill, reverts after
// 3s. Never a confirm modal.
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return armed ? (
    <button
      onClick={onConfirm}
      className="h-8 shrink-0 rounded-full bg-red-500/20 px-3 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/30 light:text-red-700"
    >
      Confirm
    </button>
  ) : (
    <button
      onClick={() => setArmed(true)}
      aria-label="Delete announcement"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/10 hover:text-ink-200"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}

// ── Editor + preview ───────────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { value: 'update' as AnnouncementLevel, label: 'Update' },
  { value: 'alert' as AnnouncementLevel, label: 'Alert' },
]

const PUBLISH_OPTIONS = [
  { value: 'draft' as PublishMode, label: 'Draft' },
  { value: 'now' as PublishMode, label: 'Publish' },
  { value: 'schedule' as PublishMode, label: 'Schedule' },
]

const NO_APP = '—'
const APP_OPTIONS = [
  { value: NO_APP, label: 'No app' },
  ...APP_REGISTRY.filter((a) => a.category !== 'admin').map((a) => ({ value: a.id, label: a.name })),
]

const FIELD =
  'h-9 w-full rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-ink/25 focus:outline-none'

function Editor({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  draft: AnnouncementDraft
  onChange: (d: AnnouncementDraft) => void
  onCancel: () => void
  onSave: (d: AnnouncementDraft) => void
  saving: boolean
}) {
  // The publish mode is STATE, seeded once from the draft — not derived from
  // publishedAt on every render. Deriving it meant "Publish" stamped
  // publishedAt with the current time, which then compared as later than the
  // render's own clock, and the control snapped straight back to "Schedule".
  const [mode, setPublishMode] = useState<PublishMode>(() => publishModeOf(draft, Date.now()))
  const [imageError, setImageError] = useState<string | null>(null)
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'),
  )
  const [previewAs, setPreviewAs] = useState<'log' | 'alert'>('log')
  const [armedPublish, setArmedPublish] = useState(false)

  const set = (patch: Partial<AnnouncementDraft>) => onChange({ ...draft, ...patch })

  function setMode(next: PublishMode): void {
    setArmedPublish(false)
    setPublishMode(next)
    if (next === 'draft') return set({ publishedAt: null })
    if (next === 'now') return set({ publishedAt: new Date().toISOString() })
    // Schedule defaults to an hour out — a datetime field that opens on "now"
    // is a publish button wearing a calendar.
    set({ publishedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
  }

  async function pickImage(file: File | undefined): Promise<void> {
    if (!file) return
    setImageError(null)
    try {
      set({ image: await prepareAnnouncementImage(file) })
    } catch (e) {
      setImageError(e instanceof Error ? e.message : String(e))
    }
  }

  const goingLive = mode !== 'draft'
  const canSave = draft.title.trim().length > 0 && !saving
  // Publishing reaches every member, so the button arms first — same two-click
  // contract as delete, for the same reason: it can't be taken back quietly.
  const primaryLabel = !goingLive
    ? 'Save draft'
    : armedPublish
      ? mode === 'schedule' ? 'Confirm schedule' : 'Confirm publish'
      : mode === 'schedule' ? 'Schedule' : 'Publish'

  function primary(): void {
    if (!canSave) return
    if (goingLive && !armedPublish) { setArmedPublish(true); return }
    onSave(draft)
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* Form */}
      <div className="space-y-4">
        <Field label="Title">
          <input
            className={FIELD}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="What's new?"
            autoFocus
          />
        </Field>

        <Field label="Body" hint="Blank line = new paragraph · “- ” = bullet · **bold** · [text](url)">
          <AutoGrowTextarea
            className="min-h-[120px] w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-100 placeholder:text-ink-600 focus:border-ink/25 focus:outline-none"
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Tell members what changed and what to do with it."
          />
        </Field>

        <Field label="Level" hint={draft.level === 'alert' ? 'Opens once as a modal on their next visit.' : 'Red dot on the Dashboard tile only.'}>
          <SegmentedToggle
            options={LEVEL_OPTIONS}
            value={draft.level}
            onChange={(level) => set({ level })}
            fitContent
          />
        </Field>

        <Field label="Video link" hint="A YouTube link renders its thumbnail on the card, no image needed.">
          <input
            className={FIELD}
            value={draft.videoUrl}
            onChange={(e) => set({ videoUrl: e.target.value })}
            placeholder="https://youtube.com/watch?v=…"
          />
        </Field>

        <Field label="Image" hint="Optional. Downscaled to 1000px and stored with the announcement.">
          <div className="flex items-center gap-2">
            <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-ink/10 px-3.5 text-[12px] text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100">
              <ImagePlus className="h-3.5 w-3.5" />
              {draft.image ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
            {draft.image && (
              <button
                onClick={() => set({ image: null })}
                className="h-9 rounded-full px-3 text-[12px] text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
              >
                Remove
              </button>
            )}
          </div>
          {imageError && <p className="mt-1.5 text-[11px] text-red-300 light:text-red-700">{imageError}</p>}
        </Field>

        <Field label="Button" hint="Optional. An app opens in place; a link opens in a new tab.">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${FIELD} sm:w-[160px]`}
              value={draft.ctaLabel}
              onChange={(e) => set({ ctaLabel: e.target.value })}
              placeholder="Label"
            />
            <Dropdown
              value={draft.ctaApp || NO_APP}
              options={APP_OPTIONS}
              onChange={(v) => set({ ctaApp: v === NO_APP ? '' : v })}
              accent="neutral"
              fitContent
              compact
            />
            <input
              className={`${FIELD} sm:flex-1`}
              value={draft.ctaUrl}
              onChange={(e) => set({ ctaUrl: e.target.value })}
              placeholder="…or a link (https://)"
            />
          </div>
        </Field>

        <Field label="Visibility">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedToggle options={PUBLISH_OPTIONS} value={mode} onChange={setMode} fitContent />
            {mode === 'schedule' && (
              <input
                type="datetime-local"
                className={`${FIELD} w-auto`}
                value={toLocalInput(draft.publishedAt)}
                onChange={(e) => set({ publishedAt: fromLocalInput(e.target.value) })}
              />
            )}
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-400">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => set({ pinned: e.target.checked })}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Pin to top
            </label>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-ink-500">Hide after</span>
            <input
              type="datetime-local"
              className={`${FIELD} w-auto`}
              value={toLocalInput(draft.expiresAt)}
              onChange={(e) => set({ expiresAt: fromLocalInput(e.target.value) })}
            />
            {draft.expiresAt && (
              <button
                onClick={() => set({ expiresAt: null })}
                className="text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-200"
              >
                clear
              </button>
            )}
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink/5 pt-4">
          <button
            onClick={primary}
            disabled={!canSave}
            className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
              armedPublish
                ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30 light:text-red-700'
                : 'bg-ink text-paper hover:bg-ink/90'
            }`}
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {primaryLabel}
          </button>
          {goingLive && !armedPublish && (
            <span className="order-last basis-full text-[11px] text-ink-600 md:order-none md:basis-auto">
              {mode === 'schedule' ? 'Goes live at the time above.' : 'Visible to every member immediately.'}
            </span>
          )}
          <button
            onClick={onCancel}
            className="ml-auto h-9 rounded-full px-3.5 text-[12px] text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        <div className="mb-2 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-ink-500" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Preview</span>
          <div className="ml-auto flex gap-1">
            <PreviewChip active={previewAs === 'log'} onClick={() => setPreviewAs('log')}>In the log</PreviewChip>
            <PreviewChip active={previewAs === 'alert'} onClick={() => setPreviewAs('alert')}>As an alert</PreviewChip>
          </div>
        </div>

        {/* Half the members are in the other theme, so the preview can switch.
            The `light:` variant matches any [data-theme="light"] ancestor and
            the token block is written against the same selector, so a nested
            wrapper genuinely re-themes its subtree. */}
        <div
          data-theme={previewTheme}
          className="rounded-3xl border border-ink/10 bg-surface-0 p-3"
        >
          {previewAs === 'alert' ? (
            <div className="rounded-2xl border border-ink/10 bg-surface-1 p-2">
              <AnnouncementCard announcement={draftToAnnouncement(draft)} image={draft.image} unread preview chrome="bare" />
              <div className="flex items-center gap-2 border-t border-ink/5 p-2 pt-2.5">
                <span className="rounded-full px-2 text-[12px] text-ink-400">See all</span>
                <span className="ml-auto rounded-full bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper">Got it</span>
              </div>
            </div>
          ) : (
            <AnnouncementCard announcement={draftToAnnouncement(draft)} image={draft.image} unread preview />
          )}
        </div>

        <div className="mt-2 flex justify-end gap-1">
          <PreviewChip active={previewTheme === 'dark'} onClick={() => setPreviewTheme('dark')}>Dark</PreviewChip>
          <PreviewChip active={previewTheme === 'light'} onClick={() => setPreviewTheme('light')}>Light</PreviewChip>
        </div>
      </div>
    </div>
  )
}

function PreviewChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? 'bg-ink/10 text-ink-100' : 'text-ink-500 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</span>
        {hint && <span className="min-w-0 text-[11px] text-ink-600 sm:truncate">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
