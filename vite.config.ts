import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  ],
  // Honor PORT when a tool (e.g. preview harness) assigns one; default 5173.
  server: {
    port: Number(process.env.PORT) || 5173,
  },
})
