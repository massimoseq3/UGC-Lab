import { Megaphone, Newspaper, Play } from 'lucide-react'
import { useAnnouncementStore, unreadCount } from '../../stores/announcementStore'
import type { Announcement } from '../../stores/announcementStore'
import { useVideoLogStore, unseenVideoCount } from '../../stores/videoLogStore'
import { youtubeThumb } from '../../components/announcements/media'
import NewBadge from '../../components/NewBadge'
import { videosByRecency, youtubeWatchUrl, type ChannelVideo } from '../../utils/channelVideos'
import { WidgetLabel } from './Widget'
import { WIDGET_SHELL, riseStyle } from './widgetStyles'

// What's New — the desktop's one feed of things that happened OUTSIDE the
// member's own work: Massimo's YouTube channel and the operator's
// announcements, in the wall's right-hand column.
//
// It was the Announcements tile (August 2026) and took the videos in alongside
// them in September 2026 (Massimo's call) — the channel is where the training
// actually lands, and a member on the Dashboard every morning is the audience
// for it. They share one tile rather than taking one each because the wall is
// a fixed set of tiles — and one PANEL as well as one tile: an announcement
// row is the only thing in the app that opens `AnnouncementsPanel`, which is
// what `buildFeed`'s guarantee below is protecting.
//
// **A few rows with big pictures, not many rows with small ones** (Massimo's
// call, and the shape this landed on after three others). Three truncated
// rows in a single-height tile read as a list you scan past; a full-width 16:9
// hero with a See All under it spent a whole column on one video; the entire
// eleven-video log at 53px a thumbnail fit, but at that size the picture is a
// swatch and the row is really just its title. The thumbnail is the thing that
// makes someone click, so it gets the space: five rows, 124px of picture each,
// and no date — a video from July is not more or less worth watching for
// saying so, and the column it took came off the title.
//
// The tile is a plain widget, not a button: every row is its own control, and
// a button can't legally contain either an <a> or another button.

/** Rows on the tile. Five is what the wall's right-hand column holds at 70px. */
const LOG_ROWS = 5

interface FeedRow {
  key: string
  /** ISO instant, sorted on. */
  at: string
  pinned: boolean
  video: ChannelVideo | null
  announcement: Announcement | null
}

// Pinned first, then newest — the announcement store's own order, extended
// over the videos so the tile reads as one list rather than two interleaved.
function byRecency(a: FeedRow, b: FeedRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.at.localeCompare(a.at)
}

function announcementRow(a: Announcement): FeedRow {
  return {
    key: `a:${a.id}`,
    at: a.publishedAt ?? a.createdAt,
    pinned: a.pinned,
    video: null,
    announcement: a,
  }
}

/**
 * The newest `LOG_ROWS`, videos and announcements merged.
 *
 * With one guarantee that outranks the date: **when announcements exist, the
 * newest one always holds a slot.** An announcement row is the only door to
 * the panel — nothing else in the app opens it — so a run of recent videos
 * pushing every announcement off this tile would strand the panel and
 * everything in it. It takes the LAST slot rather than the first, so it
 * displaces the oldest thing on the tile instead of the newest.
 */
function buildFeed(announcements: Announcement[]): FeedRow[] {
  const videos: FeedRow[] = videosByRecency().map((v) => ({
    key: `v:${v.id}`,
    at: v.published,
    pinned: false,
    video: v,
    announcement: null,
  }))
  const rows = [...videos, ...announcements.map(announcementRow)]
    .sort(byRecency)
    .slice(0, LOG_ROWS)

  // `announcements` arrives sorted by the store (pinned first, then newest),
  // so its head is the one the panel itself leads with.
  if (announcements.length > 0 && !rows.some((r) => r.announcement)) {
    rows[rows.length - 1] = announcementRow(announcements[0])
  }
  return rows
}

export default function WhatsNewTile({ index, className = '' }: { index: number; className?: string }) {
  const items = useAnnouncementStore((s) => s.items)
  const readIds = useAnnouncementStore((s) => s.readIds)
  const openPanel = useAnnouncementStore((s) => s.openPanel)
  const seenIds = useVideoLogStore((s) => s.seenIds)
  const markSeen = useVideoLogStore((s) => s.markSeen)

  const feed = buildFeed(items)
  const hasAlert = items.some((a) => a.level === 'alert' && !readIds.includes(a.id))
  // One dot for the whole tile: the corner is the "something happened while
  // you were away" light, and a member doesn't need two of them to know to
  // look down the list. Which rows are new is spelled out on the rows.
  const hasNews = unreadCount(items, readIds) > 0 || unseenVideoCount(seenIds) > 0

  return (
    <section
      style={riseStyle(index)}
      className={`widget-rise relative flex flex-col items-center p-4 text-center ${WIDGET_SHELL} ${className}`}
    >
      <WidgetLabel icon={Newspaper} label="What's New" />
      {/* Out of flow, like the Academy card's arrow: in the label row it would
          push a centred label off centre by half its own width. Ringed in the
          page fill so it reads as a badge rather than a stray pixel on the
          glass. It pulses only for an unread ALERT — the one announcement
          level allowed to interrupt. */}
      {hasNews && (
        <span
          className={`absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-surface-0 bg-red-500 ${
            hasAlert ? 'animate-pulse' : ''
          }`}
          aria-hidden
        />
      )}

      {/* Left-aligned inside a centred tile: everything else on this wall is a
          figure or a picture, which centre, and a list of titles is the one
          thing here that is read rather than looked at.

          The rows spread down the column with `justify-between`, so the list
          fills whatever height the wall hands the tile instead of bunching
          under the label with dead glass beneath it. Five rows at 70px is
          sized to land just inside that — see LOG_ROWS. */}
      <ul className="mt-3 flex w-full flex-1 flex-col justify-between gap-1 overflow-hidden text-left">
        {feed.map((row) =>
          row.video ? (
            <li key={row.key}>
              <VideoRow video={row.video} isNew={!seenIds.includes(row.video.id)} onOpen={markSeen} />
            </li>
          ) : (
            <li key={row.key}>
              <AnnouncementRow
                announcement={row.announcement!}
                unread={!readIds.includes(row.announcement!.id)}
                onOpen={openPanel}
              />
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

// Every row is the same two-part shape — a 16:9 block and the title beside it
// — so the list keeps one rhythm whether a row is a video or an announcement.
//
// The row's height is the BLOCK's, and the text column centres inside it. That
// is what lets the NEW badge take a line of its own above the title without
// making the rows it appears on taller than the rest: a badge plus two clamped
// lines is 50px inside a 70px row, and so is a bare title.
const ROW =
  'group flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-ink/[0.06]'
const BLOCK = 'relative h-[70px] w-[124px] shrink-0 overflow-hidden rounded-lg'
// NO `block` here, deliberately: `line-clamp-2` works by setting
// `display: -webkit-box`, and a `block` alongside it wins on stylesheet order
// and silently turns the clamp off — which is a three-line title in a row
// sized for two, so the row grows and the list stops spreading evenly.
const TITLE =
  'line-clamp-2 text-[12.5px] font-medium leading-snug transition-colors group-hover:text-ink-50'

function VideoRow({
  video,
  isNew,
  onOpen,
}: {
  video: ChannelVideo
  isNew: boolean
  onOpen: (id: string) => void
}) {
  return (
    <a
      href={youtubeWatchUrl(video.id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpen(video.id)}
      title={video.title}
      className={ROW}
    >
      <span className={`${BLOCK} bg-ink/10`}>
        <img
          // YouTube's own CDN, so there is nothing to store and nothing to
          // expire. `mqdefault` is the true 16:9 crop — see youtubeThumb.
          src={youtubeThumb(video.id, 'mq')}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55">
            <Play className="h-3.5 w-3.5 translate-x-[1px] fill-white text-white" strokeWidth={0} />
          </span>
        </span>
      </span>
      <span className="min-w-0 flex-1">
        {isNew && <NewBadge className="mb-1" />}
        <span className={`${TITLE} text-ink-200`}>{video.title}</span>
      </span>
    </a>
  )
}

function AnnouncementRow({
  announcement,
  unread,
  onOpen,
}: {
  announcement: Announcement
  unread: boolean
  onOpen: () => void
}) {
  return (
    <button onClick={onOpen} title={announcement.title} className={ROW}>
      {/* The announcement's stand-in for a thumbnail — same block, so the rows
          line up, and a glyph rather than a picture because there is no
          picture on the row to show. Lit while it is unread. */}
      <span className={`${BLOCK} flex items-center justify-center ${unread ? 'bg-dashboard-500/20' : 'bg-ink/[0.07]'}`}>
        <Megaphone className={`h-5 w-5 ${unread ? 'text-dashboard-400' : 'text-ink-500'}`} strokeWidth={1.5} />
      </span>
      <span className="min-w-0 flex-1">
        {unread && <NewBadge className="mb-1" />}
        <span className={`${TITLE} ${unread ? 'text-ink-100' : 'text-ink-400'}`}>{announcement.title}</span>
      </span>
    </button>
  )
}
