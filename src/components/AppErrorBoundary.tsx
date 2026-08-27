import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import AppErrorScreen from './AppErrorScreen'
import { isStaleChunkError } from '../utils/appVersion'
import { markUpdateAvailable } from '../stores/updateStore'

/**
 * The reason nothing in this app goes white any more.
 *
 * A React error thrown with no boundary above it unmounts the entire tree, and
 * the commonest one here isn't a bug at all — it's a deploy. Apps are lazy
 * chunks, a deploy renames them, and a tab that was open across it asks for a
 * file that no longer exists the moment the member opens an app they hadn't
 * opened yet. That threw inside <Suspense>, took the whole workspace with it,
 * and left a blank page that only a manual refresh explained.
 *
 * Wrapped per app pane, the blast radius is that pane: every other app stays
 * mounted with its work intact, and the member reloads when they're ready. The
 * same boundary sits at the root as a floor under everything else.
 */

interface Props {
  children: ReactNode
  /** Extra sizing for the fallback — the root copy needs its own height. */
  className?: string
}

interface State {
  failed: boolean
  stale: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, stale: false }

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, stale: isStaleChunkError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A stale chunk here is proof of a deploy, whether or not the version poll
    // has come round yet — so arm the notice for the rest of the app too.
    if (isStaleChunkError(error)) markUpdateAvailable()
    console.error('Caught by AppErrorBoundary:', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <AppErrorScreen stale={this.state.stale} className={this.props.className} />
    }
    return this.props.children
  }
}
