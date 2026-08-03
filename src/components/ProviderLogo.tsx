// Brand logos for the model picker. Paths are from simple-icons.org (CC0).
// Where a clean SVG isn't readily available (e.g. Black Forest Labs), we fall
// back to a tinted letter avatar.

interface ProviderLogoProps {
  provider: string
  size?: 'sm' | 'md'
}

const SIZE_CLASS: Record<NonNullable<ProviderLogoProps['size']>, string> = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
}

const ICON_PADDING: Record<NonNullable<ProviderLogoProps['size']>, string> = {
  sm: 'p-1',
  md: 'p-1.5',
}

interface LogoEntry {
  bg: string
  fg: string
  // viewBox + path of the brand mark, simple-icons style.
  viewBox?: string
  path?: string
  // 'evenodd' is required for ring/donut paths (outer + inner subpath).
  // Defaults to 'nonzero' (SVG default) when omitted.
  fillRule?: 'evenodd' | 'nonzero'
  // Optional component for multicolor or composite logos. It MUST be rendered
  // as an element (`<Mark />`), never called as `Mark()`: the React Compiler
  // gives each of these its own `useMemoCache(n)` hook, so calling one inline
  // runs that hook in ProviderLogo's own slot. The marks ask for different
  // cache sizes (Google 2, Kling 9), so switching provider mismatched the slot
  // and React kept rendering the previous mark — Grok showed Google's G — or
  // nothing at all.
  Mark?: React.ComponentType
}

const GoogleSvg = () => (
  <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
)

// Brand-supplied SVGs. Gradient/clipPath IDs are namespaced per component
// to avoid collisions when multiple logos render on the same page.
const KlingSvg = () => (
  <svg viewBox="0 0 512 512" fill="none" className="h-full w-full" aria-hidden>
    <path d="M115.456 293.867a494.813 494.813 0 0142.624-95.04C225.707 81.664 324.373 12.011 378.453 43.221 256.811-27.008 98.091 20.14 23.936 148.565a285.458 285.458 0 00-22.123 48.128c-5.525 15.766 1.963 32.726 16.427 41.088l97.216 56.107v-.021z" fill="url(#kling-r0)" />
    <path d="M396.544 216.832a494.717 494.717 0 01-42.645 95.04c-67.627 117.163-166.294 186.837-220.374 155.605 121.664 70.251 280.384 23.083 354.539-105.344a285.665 285.665 0 0022.123-48.106c5.525-15.744-1.963-32.726-16.427-41.067l-97.216-56.107v-.021z" fill="url(#kling-r1)" />
    <path d="M353.92 311.893c67.627-117.162 78.635-237.44 24.533-268.672-54.037-31.21-152.704 38.486-220.373 155.606 44.245-76.587 123.925-113.387 178.005-82.176 54.059 31.232 62.038 118.613 17.814 195.221l.021.021z" fill="url(#kling-l0)" />
    <path d="M158.08 198.827c-67.627 117.162-78.635 237.44-24.533 268.65 54.058 31.232 152.725-38.442 220.373-155.605-44.245 76.608-123.925 113.408-178.005 82.176-54.059-31.211-62.038-118.613-17.814-195.2l-.021-.021z" fill="url(#kling-l1)" />
    <defs>
      <radialGradient id="kling-r0" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="rotate(-59.132 311.591 48.195) scale(310.927 426.086)">
        <stop offset=".095" stopColor="#FFF959" />
        <stop offset=".326" stopColor="#0DF35E" />
        <stop offset=".64" stopColor="#0BF2F9" />
        <stop offset="1" stopColor="#04A6F0" />
      </radialGradient>
      <radialGradient id="kling-r1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="rotate(120.868 138.475 223.808) scale(310.927 426.086)">
        <stop offset=".095" stopColor="#FFF959" />
        <stop offset=".326" stopColor="#0DF35E" />
        <stop offset=".64" stopColor="#0BF2F9" />
        <stop offset="1" stopColor="#04A6F0" />
      </radialGradient>
      <linearGradient id="kling-l0" x1="332.331" y1="38.357" x2="385.323" y2="210.368" gradientUnits="userSpaceOnUse">
        <stop stopColor="#003EFF" />
        <stop offset="1" stopColor="#0BFFE7" />
      </linearGradient>
      <linearGradient id="kling-l1" x1="179.669" y1="472.363" x2="126.677" y2="300.352" gradientUnits="userSpaceOnUse">
        <stop stopColor="#003EFF" />
        <stop offset="1" stopColor="#0BFFE7" />
      </linearGradient>
    </defs>
  </svg>
)

const WanSvg = () => (
  <svg viewBox="0 0 512 512" fill="none" className="h-full w-full" aria-hidden>
    <path d="M268.885 28.587a9886.443 9886.443 0 0125.046 44.266 3.833 3.833 0 003.349 1.942h118.443c3.712 0 6.869 2.346 9.514 6.976l31.019 54.826c4.053 7.19 5.12 10.198.512 17.856a1129.453 1129.453 0 00-16.213 27.734l-7.83 14.037c-2.261 4.181-4.757 5.973-.853 10.923l56.576 98.922c3.669 6.422 2.368 10.539-.917 16.427a2813.646 2813.646 0 01-28.48 49.92c-3.392 5.803-7.51 8-14.507 7.893a916.763 916.763 0 00-49.643.342 2.12 2.12 0 00-1.728 1.066 12257.343 12257.343 0 01-57.706 101.12c-3.606 6.251-8.107 7.744-15.467 7.766-21.269.064-42.709.085-64.363.042a11.45 11.45 0 01-9.92-5.781l-28.48-49.557a1.919 1.919 0 00-1.77-1.046H106.283c-6.08.64-11.798-.021-17.174-1.962l-34.197-59.094a11.58 11.58 0 01-.043-11.52l25.75-45.226a4.225 4.225 0 000-4.203 11754.482 11754.482 0 01-40-69.803l-16.854-29.76c-3.413-6.613-3.69-10.581 2.027-20.586 9.92-17.344 19.776-34.667 29.59-51.968 2.815-4.992 6.485-7.126 12.458-7.147 18.41-.078 36.821-.085 55.232-.021a2.651 2.651 0 002.283-1.344L185.216 27.2a10.412 10.412 0 019.003-5.248c11.178-.021 22.464 0 33.77-.128l21.696-.49c7.275-.065 15.446.682 19.2 7.253zm-73.216 8.597a1.281 1.281 0 00-1.109.64l-61.141 106.987a3.347 3.347 0 01-2.88 1.664H69.397c-1.194 0-1.493.533-.874 1.578l123.946 216.662c.534.896.278 1.322-.725 1.344l-59.627.32a4.647 4.647 0 00-4.266 2.474l-28.16 49.28c-.939 1.664-.448 2.518 1.45 2.518l121.942.17c.981 0 1.706.427 2.218 1.302l29.931 52.352c.981 1.728 1.963 1.749 2.965 0l106.795-186.88 16.704-29.483a1.169 1.169 0 011.024-.601 1.17 1.17 0 011.024.601l30.379 53.973a2.599 2.599 0 002.282 1.323l58.944-.427a.846.846 0 00.858-.853.877.877 0 00-.111-.427L414.229 203.2a2.31 2.31 0 010-2.411l6.251-10.816 23.893-42.176c.512-.874.256-1.322-.746-1.322h-247.36c-1.259 0-1.558-.555-.918-1.643l30.592-53.44a2.276 2.276 0 000-2.432L196.8 37.845a1.276 1.276 0 00-1.131-.661zm134.187 171.093c.981 0 1.237.427.725 1.28l-17.749 31.254-55.744 97.813a1.199 1.199 0 01-1.067.619 1.242 1.242 0 01-1.066-.619l-73.664-128.683c-.427-.725-.214-1.109.597-1.152l4.608-.256 143.403-.256h-.043z" fill="url(#wan-l0)" />
    <defs>
      <linearGradient id="wan-l0" x1="0" y1="256" x2="512" y2="256" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6336E7" />
        <stop offset="1" stopColor="#6F69F7" />
      </linearGradient>
    </defs>
  </svg>
)

// xAI's Grok mark (two-path angular glyph). currentColor so it flips with the
// theme — white in dark, near-black in light — like the OpenAI/Anthropic marks.
const GrokSvg = () => (
  <svg viewBox="0 0 1024 1024" fill="currentColor" className="h-full w-full text-ink-100" aria-hidden>
    <path d="M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916" />
    <path d="M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339" />
  </svg>
)

const ByteDanceSvg = () => (
  <svg viewBox="0 0 512 512" fillRule="evenodd" clipRule="evenodd" className="h-full w-full" aria-hidden>
    <path d="M318.805 396.523l-36.352-9.493V213.547l38.912-9.856c21.334-5.419 39.254-9.835 40.107-9.664.683 0 1.195 47.68 1.195 106.07v106.09l-3.755-.17c-2.218 0-20.31-4.417-40.107-9.515v.02z" fill="#00c8d2" />
    <path d="M149.333 352.896c0-58.368.512-106.24 1.366-106.24.682-.17 18.602 4.267 40.106 9.685l38.742 9.835-.342 86.4-.512 86.379-34.816 9.003c-19.114 4.906-37.034 9.493-39.594 10.005l-4.95 1.195V352.896z" fill="#3c8cff" />
    <path d="M410.454 266.176c0-192.64.17-202.987 3.072-202.133 1.536.512 16.725 4.416 33.62 8.661 16.897 4.416 33.622 8.64 37.206 9.493l6.315 1.707-.341 182.613-.512 182.785-34.646 8.832c-18.944 4.906-36.864 9.322-39.594 10.026l-5.12 1.174V266.176z" fill="#78e6dc" />
    <path d="M21.333 266.859c0-99.798.512-181.44 1.366-181.44.682 0 18.602 4.416 39.936 9.685l38.912 9.835v161.75c0 88.746-.342 161.578-.683 161.578-.512 0-18.603 4.587-40.107 10.027l-39.424 9.984v-181.44.02z" fill="#325ab4" />
  </svg>
)

// MiniMax's wordless bar mark, in the brand's pink→orange gradient.
const MinimaxSvg = () => (
  <svg viewBox="0 0 24 24" fillRule="nonzero" className="h-full w-full" aria-hidden>
    <path d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z" fill="url(#minimax-l0)" />
    <defs>
      <linearGradient id="minimax-l0" x1="0%" y1="50%" x2="100%" y2="50%" >
        <stop stopColor="#E2167E" />
        <stop offset="1" stopColor="#FE603C" />
      </linearGradient>
    </defs>
  </svg>
)

const PROVIDERS: Record<string, LogoEntry> = {
  Google: {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: GoogleSvg,
  },
  OpenAI: {
    bg: 'bg-ink/[0.04]',
    fg: 'text-ink-100',
    viewBox: '0 0 24 24',
    path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4069-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  },
  Anthropic: {
    bg: 'bg-ink/[0.04]',
    fg: 'text-orange-300 light:text-orange-700',
    viewBox: '0 0 24 24',
    path: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z',
  },
  ByteDance: {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: ByteDanceSvg,
  },
  'Kling AI': {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: KlingSvg,
  },
  xAI: {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: GrokSvg,
  },
  MiniMax: {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: MinimaxSvg,
  },
  'Alibaba Tongyi': {
    bg: 'bg-ink/[0.04]',
    fg: '',
    Mark: WanSvg,
  },
  ElevenLabs: {
    bg: 'bg-ink/[0.04]',
    fg: 'text-ink-100',
    viewBox: '0 0 24 24',
    path: 'M7.4 4h2.4v16H7.4V4zm6.8 0h2.4v16h-2.4V4z',
  },
  'Black Forest Labs': {
    bg: 'bg-ink/[0.04]',
    fg: 'text-amber-200 light:text-amber-800',
    viewBox: '0 0 24 24',
    path: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.6 3.7L12 11.7 5.4 8 12 4.3zM5 9.7l6 3.4v7.4l-6-3.3V9.7zm14 0v7.5l-6 3.3v-7.4l6-3.4z',
  },
  Kuaishou: {
    bg: 'bg-ink/[0.04]',
    fg: 'text-fuchsia-300 light:text-fuchsia-700',
    viewBox: '0 0 24 24',
    path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-2.5 5.7L15 12l-5.5 3.3V8.7z',
  },
}

function FallbackLetter({ provider, size }: { provider: string; size: NonNullable<ProviderLogoProps['size']> }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-ink-800/60 font-semibold text-ink-300 ${SIZE_CLASS[size]} ${size === 'sm' ? 'text-[10px]' : 'text-[11px]'}`}>
      {provider.charAt(0).toUpperCase()}
    </div>
  )
}

export default function ProviderLogo({ provider, size = 'md' }: ProviderLogoProps) {
  const entry = PROVIDERS[provider]
  if (!entry) return <FallbackLetter provider={provider} size={size} />

  const Mark = entry.Mark

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full ${entry.bg} ${SIZE_CLASS[size]} ${ICON_PADDING[size]}`}>
      {Mark ? (
        <Mark />
      ) : (
        <svg viewBox={entry.viewBox} className={`h-full w-full ${entry.fg}`} fill="currentColor" aria-hidden>
          <path d={entry.path} fillRule={entry.fillRule} />
        </svg>
      )}
    </div>
  )
}
