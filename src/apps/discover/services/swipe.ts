// Reading a filed swipe back as the card it was saved from.
//
// The swipe file's whole promise is "find a winner now, tear it down later", so
// a saved row has to reach the same detail view — and the same Analyze Ad
// button — that the search grid does. Rather than a second modal that drifts
// from the first, a swipe is adapted BACK into a DiscoverResult and fed to the
// one `ResultDetailModal`.

import type { SwipeItem } from '../../../stores/types'
import type { DiscoverResult } from '../types'
import { bandFor } from './scoring'

/**
 * A filed swipe as the card it came from.
 *
 * `coverUrl` is passed in rather than read off the row because the row stores an
 * asset REF, not a url — only a component can resolve one (`useAssetUrl`), and
 * this has to stay callable outside React.
 *
 * Three fields are gone for good and the modal already renders around each of
 * them: the author's avatar, the ad's landing url and its publisher platforms
 * are never persisted, so those blocks simply don't appear. What is deliberately
 * NOT reconstructed is anything live — the stats are the ones snapshotted at
 * save time, because a swipe records what a winner looked like when you found
 * it. Today's numbers belong to a fresh search.
 */
export function swipeToResult(item: SwipeItem, coverUrl?: string): DiscoverResult {
  return {
    id: item.sourceId,
    platform: item.platform,
    caption: item.caption,
    postUrl: item.postUrl,
    coverUrl,
    // Signed and probably expired. The modal plays it when it still works and
    // the swipe file offers to re-resolve it when it doesn't.
    videoUrl: item.mediaUrl,
    createdAt: item.createdAt,
    author: {
      handle: item.authorHandle,
      name: item.authorName,
      followerCount: item.followerCount,
    },
    // Only the cells the platform actually gave us, and only when it gave at
    // least one: Meta publishes none, Instagram publishes likes and comments
    // and no views. Filling the rest with zeros would print "0 saves" on a
    // reel Instagram simply doesn't report saves for — the same invention the
    // Meta tab refuses to make with an outlier score.
    stats: hasStats(item)
      ? {
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          saves: item.saves,
        }
      : undefined,
    outlier: item.outlierMultiple != null && bandFor(item.outlierMultiple)
      ? { multiple: item.outlierMultiple, band: bandFor(item.outlierMultiple)! }
      : undefined,
    // daysRunning is the only piece of `ad` that survives a save; isActive is
    // asserted false rather than guessed, and nothing in the modal reads it.
    ad: item.daysRunning != null
      ? { isActive: false, daysRunning: item.daysRunning, platforms: [] }
      : undefined,
  }
}

/** True when the row snapshotted any figure at all. */
function hasStats(item: SwipeItem): boolean {
  return item.views != null || item.likes != null || item.comments != null
    || item.shares != null || item.saves != null
}
