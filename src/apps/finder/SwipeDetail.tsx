// Opening a filed swipe as the card it was saved from.
//
// The swipe file is where you keep an ad to tear down later, so a saved row has
// to reach the same detail view — and the same Analyze Ad button — that the
// Outliers grid does. It renders the one `ResultDetailModal` rather than a
// second copy that would drift from it; everything specific to a SAVED ad
// (an expired video link, a transcript worth keeping) lives here.

import { useCallback, useState } from 'react'
import { RotateCw } from 'lucide-react'
import Spinner from '../../components/Spinner'
import ResultDetailModal from '../discover/components/ResultDetailModal'
import { swipeToResult } from '../discover/services/swipe'
import { refreshResultMedia } from '../discover/services/search'
import {
  downloadResultVideo,
  fetchResultTranscript,
  saveVideoFileToDisk,
} from '../discover/services/handoff'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { humanizeError } from '../../utils/friendlyError'
import type { DiscoverAction, TranscriptState } from '../discover/Discover'
import type { DiscoverResult } from '../discover/types'
import type { SwipeItem } from '../../stores/types'

/**
 * Fetches the ad's video, re-resolving the link once if it has expired.
 *
 * A saved row's `mediaUrl` is a signed CDN link with hours (TikTok) or days
 * (Meta) on it, so the first attempt is free and usually fails. `refresh` costs
 * a ScrapeCreators credit, which is why it only ever runs off the back of a
 * real failure — never speculatively, and never on opening a card.
 *
 * Module scope on purpose: a `try`/`finally` inside a component makes the React
 * Compiler skip the whole thing.
 */
async function downloadWithRefresh(
  result: DiscoverResult,
  refresh: () => Promise<string | null>,
): Promise<File> {
  try {
    if (result.videoUrl) return await downloadResultVideo(result)
  } catch {
    // Expired, pulled, or region-blocked — indistinguishable from here, and the
    // answer is the same either way: ask the platform for a current link.
  }
  const fresh = await refresh()
  if (!fresh) throw new Error('This ad’s video could not be reached.')
  return await downloadResultVideo({ ...result, videoUrl: fresh })
}

interface SwipeDetailProps {
  item: SwipeItem
  onClose: () => void
}

export default function SwipeDetail({ item, onClose }: SwipeDetailProps) {
  const thumbUrl = useAssetUrl(item.thumbRef ?? '')
  const apiKey = useSettingsStore((s) => s.scrapeCreatorsKey)
  const addToast = useAppStore((s) => s.addToast)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const openApp = useAppStore((s) => s.openApp)
  const updateSwipe = useBankStore((s) => s.updateSwipe)

  // The link we're currently playing. Starts as the one saved with the row and
  // is replaced — in the row as well as on screen — by a refresh, so a second
  // visit inside the new link's lifetime costs nothing.
  const [mediaUrl, setMediaUrl] = useState(item.mediaUrl)
  const [mediaDead, setMediaDead] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<DiscoverAction | null>(null)

  // A transcript bought here is written back to the row, so the swipe file is
  // where you pay for the words once rather than once per visit.
  const [transcript, setTranscript] = useState<TranscriptState>(
    item.transcript ? { phase: 'ready', text: item.transcript } : { phase: 'idle' },
  )

  // A link we've watched fail is dropped rather than re-rendered: the browser
  // leaves a dead <video> looking like a player, transport controls and all, so
  // it reads as something you could press when nothing will ever come of it.
  // Without a url the modal falls back to the saved thumbnail, which is honest.
  const result = swipeToResult(
    { ...item, mediaUrl: mediaDead ? undefined : mediaUrl },
    thumbUrl || undefined,
  )

  /**
   * Buys a current media url for this ad. 1 credit.
   *
   * Returns the url, or null when there was nothing to get — a deleted post, a
   * missing key, a failed call. Never throws: every caller has a sensible
   * fallback (leave the poster up, keep the Analyze error).
   */
  const refresh = useCallback(async (): Promise<string | null> => {
    if (!apiKey) {
      addToast('Connect your ScrapeCreators key in Outliers to restore this video.', 'error')
      return null
    }
    setRefreshing(true)
    try {
      const fresh = await refreshResultMedia(apiKey, item.platform, {
        sourceId: item.sourceId,
        postUrl: item.postUrl,
      })
      if (!fresh.videoUrl) {
        addToast('This ad is no longer available on the platform.', 'info')
        return null
      }
      setMediaUrl(fresh.videoUrl)
      setMediaDead(false)
      // Background, like every other bank write — the UI never waits on a sync.
      void updateSwipe(item.id, { mediaUrl: fresh.videoUrl })
      return fresh.videoUrl
    } catch (e) {
      addToast(humanizeError(e, "Couldn't reach that ad. Try again in a moment."), 'error')
      return null
    } finally {
      setRefreshing(false)
    }
  }, [apiKey, item.platform, item.sourceId, item.postUrl, item.id, addToast, updateSwipe])

  const handleAnalyze = useCallback(async () => {
    setBusy('analyze')
    try {
      const file = await downloadWithRefresh(result, refresh)
      sendToApp({
        targetApp: 'ad-anatomy',
        targetField: 'adVideo',
        data: { file, sourceUrl: item.postUrl, caption: item.caption },
      })
      openApp('ad-anatomy')
      onClose()
    } catch (e) {
      addToast(humanizeError(e, "Couldn't import that video. Try opening the original instead."), 'error')
    } finally {
      setBusy(null)
    }
  }, [result, refresh, sendToApp, openApp, onClose, item.postUrl, item.caption, addToast])

  const handleDownload = useCallback(async () => {
    setBusy('download')
    try {
      // Re-resolves first so the saved-to-disk path gets the same second chance
      // Analyze does, rather than failing on a link that expired weeks ago.
      saveVideoFileToDisk(await downloadWithRefresh(result, refresh), result)
    } catch (e) {
      addToast(humanizeError(e, "Couldn't download that video. Try opening the original instead."), 'error')
    } finally {
      setBusy(null)
    }
  }, [result, refresh, addToast])

  const handleFetchTranscript = useCallback(async (_r: DiscoverResult, useAi = false) => {
    if (!apiKey) {
      setTranscript({ phase: 'error', message: 'Connect your ScrapeCreators key in Outliers first.' })
      return
    }
    setTranscript({ phase: 'loading' })
    try {
      const { text } = await fetchResultTranscript(apiKey, result, useAi)
      setTranscript(text.trim() ? { phase: 'ready', text } : { phase: 'empty' })
      // Kept on the row, so this is paid for once and not once a visit.
      if (text.trim()) void updateSwipe(item.id, { transcript: text })
    } catch (e) {
      setTranscript({ phase: 'error', message: humanizeError(e, "Couldn't pull that transcript.") })
    }
  }, [apiKey, result, item.id, updateSwipe])

  const handleRemix = useCallback(async () => {
    if (transcript.phase !== 'ready') return
    sendToApp({ targetApp: 'script-architect', targetField: 'winningTranscript', data: transcript.text })
    openApp('script-architect')
    onClose()
  }, [transcript, sendToApp, openApp, onClose])

  // Offered only once the player has actually failed, or when the row never had
  // a link to begin with. The credit is named on the button for the same reason
  // Outliers names it on "Get transcript": spending one is the member's call.
  const needsRestore = !mediaUrl || mediaDead

  return (
    <ResultDetailModal
      result={result}
      transcript={transcript}
      onClose={onClose}
      onAnalyze={() => void handleAnalyze()}
      onFetchTranscript={(r, useAi) => void handleFetchTranscript(r, useAi)}
      onRemix={handleRemix}
      onDownload={() => void handleDownload()}
      busy={busy}
      onMediaError={() => setMediaDead(true)}
      mediaOverlay={needsRestore ? (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-4 pb-5 pt-10 text-center">
          <p className="text-[12px] leading-relaxed text-white/70">
            {mediaDead
              ? 'The saved link to this video has expired.'
              : 'This swipe was filed without a video link.'}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? <Spinner className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
            Restore video · 1 credit
          </button>
        </div>
      ) : undefined}
    />
  )
}
