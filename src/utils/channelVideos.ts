// Massimo's YouTube log — the videos the Dashboard's What's New tile leads
// with and its panel lists in full, beside the announcements.
//
// It is a HAND-MAINTAINED list, on purpose (September 2026, Massimo's call).
// The alternatives were a YouTube Data API key (a quota, a secret and a
// billing account to keep alive) or the channel's RSS feed through a server
// proxy — and the feed is CORS-blocked from a browser, so that hop would be a
// new route in `api/`, a new host on the fetch-media allowlist and a cache to
// stop every member's page load hitting youtube.com. All of that to publish
// something that changes once a fortnight and that Massimo is present for
// anyway. He posts a video, he says so, this list grows by one line.
//
// **To add a video:** put it at the TOP of `CHANNEL_VIDEOS` with its 11-char
// id (the `v=` in the watch URL) and the publish date. The order in this array
// is not load-bearing — the tile sorts by `published` — but keeping it
// newest-first makes the file read like the channel does.

export interface ChannelVideo {
  /** The 11-character YouTube id — the `v=` in a watch URL. */
  id: string
  title: string
  /** ISO date the video went live. Sorted on, and shown as "5 Sep". */
  published: string
}

/** The channel itself, for anywhere that wants the whole back catalogue. */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@massimoseq'

export const CHANNEL_VIDEOS: ChannelVideo[] = [
  { id: 'JgoPiiBhdn8', title: 'I Studied 1,000 UGC Ads, These 3 Will Make You Money', published: '2026-09-05' },
  { id: 'e81bKzMNXB4', title: 'How to Make Viral AI UGC Ads with Seedance 2.5', published: '2026-08-14' },
  { id: 'ek-vqW_TPd8', title: 'Claude + Gemini Omni = 50 Viral AI UGC Ads a Day (Full Tutorial)', published: '2026-08-08' },
  { id: 'jWO94NXSzds', title: 'How I Fully Automated Video Editing (Claude Code)', published: '2026-07-30' },
  { id: 'vVV7sLfbAfM', title: 'How to Automate 90% of AI UGC Ads with Claude Code', published: '2026-07-27' },
  { id: 'IB_sLVz7FOA', title: 'Claude + Gemini Omni Just Changed AI UGC Ads Forever', published: '2026-07-21' },
  { id: 'RNZT3PvLy5s', title: 'How to Turn ANY Product Image into AI UGC Ads (2026)', published: '2026-07-05' },
  { id: 'f_FVPKJrgMA', title: 'The NEW Way to Make Realistic AI Influencers (Gemini Omni)', published: '2026-07-02' },
  { id: 'dNioqCulGgU', title: 'Stop Making AI UGC Ads Without This Claude Code System', published: '2026-06-11' },
  { id: 'KyiUOvzr6QE', title: 'Claude Code: Build a Full AI UGC Ads Team in 22 mins', published: '2026-03-17' },
  { id: '4zMixfAIOZ8', title: "How I Create Killer AI UGC Ads (that don't look fake)", published: '2026-02-04' },
]

/** The watch page for a video id. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

/** Newest first. The array is authored that way; this is what enforces it. */
export function videosByRecency(): ChannelVideo[] {
  return [...CHANNEL_VIDEOS].sort((a, b) => b.published.localeCompare(a.published))
}
