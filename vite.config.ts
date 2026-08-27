import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The identity of THIS build, baked into the bundle and written out beside it
// as /version.json. The running app polls that file and compares: when the two
// disagree, a deploy has happened underneath a member who is still on the old
// one (see hooks/useAppUpdateCheck.ts). The commit sha is the honest value on
// Vercel; a local build falls back to the clock, which is fine because the only
// thing that matters is that it CHANGES per build.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `local-${Date.now()}`

// Emitted through the bundle rather than dropped in public/, because public/ is
// copied verbatim and can't carry a value computed at build time.
function versionFile(): Plugin {
  return {
    name: 'ugc-os-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID }),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // React Compiler. The codebase already lints against its rules
    // (eslint-plugin-react-hooks v7 ships them), so turning the transform on is
    // what actually collects the payoff: every component and hook gets
    // memoized automatically, so a keystroke in one panel stops re-rendering
    // the panel beside it. Hand-written React.memo/useMemo stay valid — the
    // compiler works with them — but new code shouldn't need them.
    // Components that break the rules are skipped individually, not fatally
    // (`npx eslint .` lists them; today it's Insights + ModelSidePanel).
    react({ babel: { plugins: ['babel-plugin-react-compiler'] } }),
    tailwindcss(),
    versionFile(),
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // Honor PORT when a tool (e.g. preview harness) assigns one; default 5173.
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
