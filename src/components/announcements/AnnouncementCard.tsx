import { useEffect } from 'react'
import { ArrowUpRight, Play, Siren } from 'lucide-react'
import type { Announcement } from '../../stores/announcementStore'
import { useAnnouncementStore } from '../../stores/announcementStore'
import { useAppStore } from '../../stores/appStore'
import { getAppConfig } from '../../utils/constants'
import AnnouncementBody from './AnnouncementBody'
import { isSafeHttpUrl, youtubeId, youtubeThumb } from './media'

// One announcement, rendered exactly once in the codebase and reused three
// ways: down the log panel, inside the alert modal, and in the admin editor's
// preview. That's the whole point — the preview can't drift from what members
// see, because it IS what members see.

interface CtaTarget {
  label: string
  /** 'app' opens a dock app in place; 'url' leaves the workspace. */
  kind: 'app' | 'url'
  target: string
}

/** The card's one call to action, if it has one. An app jump beats a link. */
function announcementCta(a: Announcement): CtaTarget | null {
  if (a.ctaApp) {
    const app = getAppConfig(a.ctaApp)
    if (app) return { label: a.ctaLabel?.trim() || `Open ${app.name}`, kind: 'app', target: a.ctaApp }
  }
  if (isSafeHttpUrl(a.ctaUrl)) {
    return { label: a.ctaLabel?.trim() || 'Learn more', kind: 'url', target: a.ctaUrl!.trim() }
  }
  if (isSafeHttpUrl(a.videoUrl)) {
    return {
      label: a.ctaLabel?.trim() || (youtubeId(a.videoUrl) ? 'Watch on YouTube' : 'Watch'),
      kind: 'url',
      target: a.videoUrl!.trim(),
    }
  }
  return null
}

function announcementDate(a: Announcement): string {
  const iso = a.publishedAt ?? a.createdAt
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  announcement: Announcement
  /** Resolved image data URI. Omit to let the card fetch its own. */
  image?: string | null
  unread?: boolean
  /** Preview mode: no store reads, no navigation, nothing marked read. */
  preview?: boolean
  /** Called after an in-app CTA fires, so the panel around it can close. */
  onNavigate?: () => void
  /**
   * 'framed' is the log/preview card. 'bare' drops the border and fill for a
   * surface that already provides them (the alert modal) — a prop rather than
   * an override class, because two competing bg-* utilities resolve by
   * stylesheet order, not by which one was passed in last.
   */
  chrome?: 'framed' | 'bare'
  className?: string
}

export default function AnnouncementCard({
  announcement: a,
  image,
  unread = false,
  preview = false,
  onNavigate,
  chrome = 'framed',
  className = '',
}: Props) {
  const openApp = useAppStore((s) => s.openApp)
  const storedImage = useAnnouncementStore((s) => s.images[a.id])
  const loadImage = useAnnouncementStore((s) => s.loadImage)

  // The list query never carries image payloads (see the store), so a card that
  // wasn't handed one fetches its own the first time it renders.
  useEffect(() => {
    if (preview || image !== undefined || !a.hasImage) return
    void loadImage(a.id)
  }, [preview, image, a.hasImage, a.id, loadImage])

  const resolved = image !== undefined ? image : storedImage ?? null
  const video = youtubeId(a.videoUrl)
  const media = resolved ?? (video ? youtubeThumb(video) : null)
  const cta = announcementCta(a)
  const isAlert = a.level === 'alert'

  function fire() {
    if (preview || !cta) return
    if (cta.kind === 'app') {
      openApp(cta.target)
      onNavigate?.()
    } else {
      window.open(cta.target, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <article
      className={`overflow-hidden rounded-2xl ${
        chrome === 'bare'
          ? ''
          : `border bg-ink/[0.02] light:bg-white/60 ${isAlert ? 'border-red-500/30' : 'border-ink/10'}`
      } ${className}`}
    >
      {media && (
        // The picture links out when there's a video behind it — a play badge
        // that isn't clickable is worse than no badge.
        <MediaFrame
          src={media}
          isVideo={Boolean(video) && !resolved}
          href={preview ? null : isSafeHttpUrl(a.videoUrl) ? a.videoUrl! : null}
        />
      )}

      <div className="p-4">
        <div className="flex items-center gap-2">
          {isAlert && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-red-300 light:text-red-700">
              <Siren className="h-3 w-3" strokeWidth={2} />
              Alert
            </span>
          )}
          {unread && !isAlert && (
            <span className="inline-flex items-center rounded-full bg-dashboard-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-dashboard-400">
              New
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-ink-600">{announcementDate(a)}</span>
        </div>

        <h3 className="mt-2 text-[15px] font-semibold leading-snug tracking-tight text-ink-100">{a.title}</h3>
        <AnnouncementBody body={a.body} className="mt-2" />

        {cta && (
          <button
            onClick={fire}
            className={`mt-3.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold transition-colors ${
              isAlert
                ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25 light:text-red-700'
                : 'bg-ink text-paper hover:bg-ink/90'
            }`}
          >
            {cta.label}
            {cta.kind === 'url' ? (
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} />
            ) : null}
          </button>
        )}
      </div>
    </article>
  )
}

function MediaFrame({ src, isVideo, href }: { src: string; isVideo: boolean; href: string | null }) {
  const inner = (
    <>
      <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/35">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
            <Play className="ml-0.5 h-5 w-5 fill-white text-white" strokeWidth={1.5} />
          </span>
        </span>
      )}
    </>
  )
  const frame = 'group relative block aspect-video w-full overflow-hidden bg-ink/[0.06]'
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={frame}>{inner}</a>
  ) : (
    <div className={frame}>{inner}</div>
  )
}
