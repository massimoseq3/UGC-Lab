import { useCallback, useEffect, useRef, useState } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// One clip plays at a time, app-wide.
//
// Every video surface that can make noise — B-Roll's variation + clip cards,
// the detail-modal galleries, Playground's history grid and its lightbox —
// claims this single slot when the user starts it, and claiming pauses whoever
// held it. Before this, two grids' worth of clips could play over each other.
//
// A module-level pointer rather than a store: nothing renders off it (each
// holder resets its own React state through the `stop` callback it registers),
// so there's no reason to make every tile in a gallery re-render on a claim.
// ────────────────────────────────────────────────────────────────────────────

type Holder = { el: HTMLVideoElement; stop: () => void }

let holder: Holder | null = null

/** Take the playback slot, stopping whoever held it. */
export function claimVideoPlayback(el: HTMLVideoElement, stop: () => void) {
  if (holder && holder.el !== el) {
    holder.el.pause()
    holder.stop()
  }
  holder = { el, stop }
}

/** Give up the slot — a no-op unless this element still holds it, so the
 *  `pause` event fired by a claim can't clear the new holder. */
export function releaseVideoPlayback(el: HTMLVideoElement) {
  if (holder?.el === el) holder = null
}

/** True while some OTHER clip owns playback — silent hover previews stand
 *  down rather than animating over the clip the user is actually watching. */
export function videoPlaybackHeldByOther(el: HTMLVideoElement | null) {
  return !!holder && holder.el !== el
}

/**
 * The card-face / gallery-tile player: hover autoplays muted (browsers block
 * unmuted autoplay), and the Play button — a real user gesture — plays with
 * sound and keeps playing after the pointer leaves.
 *
 * Spread `hoverProps` on the tile ROOT, not the `<video>`: the overlay buttons
 * sit on top of the video but aren't its DOM children, so hovering one would
 * otherwise read as a mouseleave and kill the preview mid-hover.
 */
export function useInlineVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [unmuted, setUnmuted] = useState(false)

  // Hand the slot back if the tile unmounts mid-playback (gallery re-render,
  // modal close) — otherwise a stale holder blocks every hover preview.
  useEffect(() => {
    const el = videoRef.current
    return () => { if (el) releaseVideoPlayback(el) }
  }, [])

  const claim = useCallback((v: HTMLVideoElement) => {
    claimVideoPlayback(v, () => { v.muted = true; setUnmuted(false) })
  }, [])

  // The button pauses only what it started: a silent hover preview is running
  // for free under the pointer, so clicking Play there means "let me hear it",
  // not "stop". Only a clip already playing WITH SOUND toggles off.
  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = videoRef.current
    if (!v) return
    if (unmuted && !v.paused) {
      v.pause()
      releaseVideoPlayback(v)
    } else {
      claim(v)
      setUnmuted(true)
      v.muted = false
      v.play().catch(() => {})
    }
  }, [claim, unmuted])

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = videoRef.current
    const next = !unmuted
    if (v) {
      v.muted = !next
      // Unmuting a hover preview is the same commitment as pressing Play.
      if (next) claim(v)
      else releaseVideoPlayback(v)
    }
    setUnmuted(next)
  }, [claim, unmuted])

  const onMouseEnter = useCallback(() => {
    setHovering(true)
    const v = videoRef.current
    if (v && !unmuted && !videoPlaybackHeldByOther(v)) v.play().catch(() => {})
  }, [unmuted])

  const onMouseLeave = useCallback(() => {
    setHovering(false)
    const v = videoRef.current
    // An explicit play outlives the hover; only the silent preview rewinds.
    if (v && !unmuted) { v.pause(); v.currentTime = 0 }
  }, [unmuted])

  return {
    videoRef,
    hovering,
    playing,
    unmuted,
    // The user is watching this clip with sound: the tile's other hover icons
    // step aside and leave only play/pause + mute on the media.
    watching: playing && unmuted,
    togglePlay,
    toggleMute,
    /** Spread on the tile root (the `group` element). */
    hoverProps: { onMouseEnter, onMouseLeave },
    /** Spread on the `<video>`. */
    videoProps: {
      ref: videoRef,
      muted: !unmuted,
      loop: true,
      playsInline: true,
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
    },
  }
}

/**
 * For players that keep the browser's native `controls` (the Playground
 * lightbox, the Ad Analyzer source clip): no custom UI, just the same
 * one-at-a-time rule.
 */
export function useExclusiveVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    return () => { if (el) releaseVideoPlayback(el) }
  }, [])

  return {
    ref: videoRef,
    onPlay: () => {
      const v = videoRef.current
      if (v) claimVideoPlayback(v, () => {})
    },
    onPause: () => {
      const v = videoRef.current
      if (v) releaseVideoPlayback(v)
    },
  }
}
