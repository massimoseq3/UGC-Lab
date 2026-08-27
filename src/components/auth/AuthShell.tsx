import AppLogo from '../AppLogo'
import AppBackground from '../AppBackground'

// The chrome every signed-out screen shares: wallpaper, brand, one centred
// max-w-sm column, and the legal row at the foot. Extracted when password
// recovery and the lapsed-member gate arrived — three copies of this markup
// would have drifted the way every other near-duplicate in this app did.
export default function AuthShell({
  subtitle,
  children,
}: {
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-surface-0 text-ink antialiased">
      <AppBackground />

      <div className="relative z-10 flex h-full w-full items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2">
            <AppLogo className="h-12 w-12" />
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-ink-100">UGC OS</h1>
              <p className="text-sm text-ink-500">{subtitle}</p>
            </div>
          </div>

          {children}

          <div className="flex items-center justify-center gap-3 text-[11px] text-ink-600">
            <a href="/legal/terms" className="transition-colors hover:text-ink-300">Terms</a>
            <span aria-hidden>·</span>
            <a href="/legal/privacy" className="transition-colors hover:text-ink-300">Privacy</a>
            <span aria-hidden>·</span>
            <a href="/legal/aup" className="transition-colors hover:text-ink-300">AUP</a>
          </div>
        </div>
      </div>
    </div>
  )
}

// The one field shape these screens use. Matches the inputs AuthScreen already
// had — rounded-lg rather than the app's rounded-full, because a stacked form
// of labelled fields is not a row of chips.
export function AuthField({
  label,
  hint,
  ...input
}: { label: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
        {label}
      </label>
      <input
        {...input}
        className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
      />
      {hint && <p className="mt-1 text-[11px] text-ink-600">{hint}</p>}
    </div>
  )
}
