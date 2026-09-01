import {
  Bookmark,
  UserRound,
  Eye,
  PenLine,
  Mic,
  Film,
  Package,
  FileText,
  Shield,
  ImagePlay,
  LayoutDashboard,
  Scissors,
  Palette,
  Radar,
} from 'lucide-react'
import type { ElementType } from 'react'

// The community this workspace gates access to. Shown to disabled/non-member
// accounts as a link back to join.
export const SKOOL_COMMUNITY_URL = 'https://www.skool.com/ugcos'

// The one classroom page inside the community that carries the current access
// code. Linked from the two places the app asks for that code — signup and the
// lapsed-member screen — so nobody has to go hunting for it mid-form. It is a
// members-only page: someone who has genuinely left the community lands on the
// group's join page instead, which is where they need to be anyway.
export const SKOOL_ACCESS_CODE_URL = 'https://www.skool.com/ugcos/classroom/b3547c73?md=9feef1bebf964a868572185b78164206'

// The paid training classroom inside the community — surfaced from the
// Dashboard as the "AI UGC Academy" shortcut.
export const AI_UGC_ACADEMY_URL = 'https://www.skool.com/ugcos/classroom/bd64d8bd?md=667c539f37fb4b11a832c3ad705cd4c8'

// 'system' is the Dashboard's own leading dock group (its divider separates it
// from Bank); admin never renders in the dock.
export type AppCategory = 'library' | 'create' | 'deliver' | 'tools' | 'admin' | 'system'

export interface AppConfig {
  id: string
  name: string
  icon: ElementType
  accent: string
  category: AppCategory
}

export const APP_REGISTRY: AppConfig[] = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, accent: '#059669', category: 'system' },
  { id: 'finder', name: 'Bank', icon: Bookmark, accent: '#a1a1aa', category: 'library' },
  // The create group runs the production line in order: character → script →
  // voice → B-Roll → Playground → Edit, which closes the row (everything
  // produced on its left gets cut into a finished ad via the /video-editor
  // Claude skill). Playground sits beside B-Roll because it's the other place
  // footage gets made — the pick-up shot you go and grab when the storyboard
  // came back one clip short — so it belongs next to it rather than a divider
  // away with the research tools.
  { id: 'character-studio', name: 'Characters', icon: UserRound, accent: '#F74F9E', category: 'create' },
  { id: 'script-architect', name: 'Scripts', icon: PenLine, accent: '#24365A', category: 'create' },
  { id: 'voice-studio', name: 'Voiceovers', icon: Mic, accent: '#007AFF', category: 'create' },
  { id: 'broll-studio', name: 'B-Roll', icon: Film, accent: '#7165FF', category: 'create' },
  { id: 'playground', name: 'Playground', icon: ImagePlay, accent: '#015C52', category: 'create' },
  // Edit is fenced off in a group of its own, so a divider falls to the right
  // of Playground: it is where the production line ENDS, and the one app that
  // generates nothing in the browser — it hands out a Claude skill the member
  // runs locally. Its position in the row is unchanged; the hairline is the
  // only thing the group adds.
  { id: 'edit-studio', name: 'Edit', icon: Scissors, accent: '#F77646', category: 'deliver' },
  // Tools sit in their own fenced group between Bank and the Create row — a
  // divider on each side — because research is what happens before the
  // production line, not after it. Outliers leads the group because the loop
  // runs left to right: find a winning ad → tear it down.
  //
  // The id is 'discover' and stays that way: it keys the persisted search,
  // filters and sort. The display name is free to change.
  { id: 'discover', name: 'Outliers', icon: Radar, accent: '#D9A404', category: 'tools' },
  { id: 'ad-anatomy', name: 'Ad Analyzer', icon: Eye, accent: '#FF5257', category: 'tools' },
  { id: 'admin', name: 'Admin', icon: Shield, accent: '#fafafa', category: 'admin' },
]

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  library: 'Library',
  create: 'Create',
  deliver: 'Deliver',
  tools: 'Tools',
  admin: 'Admin',
  system: 'System',
}

export type BankType = 'products' | 'models' | 'scripts' | 'voices' | 'brolls' | 'styles' | 'swipes'

export const BANK_CONFIG: Record<BankType, { label: string; icon: ElementType; accent: string }> = {
  products: { label: 'Products', icon: Package, accent: '#38BDF8' },
  models: { label: 'Characters', icon: UserRound, accent: '#F74F9E' },
  scripts: { label: 'Scripts', icon: FileText, accent: '#24365A' },
  voices: { label: 'Voices', icon: Mic, accent: '#007AFF' },
  brolls: { label: 'B-Rolls', icon: Film, accent: '#7165FF' },
  styles: { label: 'Visual Styles', icon: Palette, accent: '#0D9488' },
  // The swipe file behind Outliers — same gold accent as the app that fills it.
  swipes: { label: 'Swipe File', icon: Bookmark, accent: '#D9A404' },
}

// The dock's group order, and therefore the order the work runs in: Dashboard,
// then Bank, then the research tools, then the Create line. It lives here rather
// than in the dock because a second surface now reads it — Meet Your Team lays
// the crew out as ONE chain, and the intro promising an order the dock doesn't
// keep is exactly the drift this prevents. `admin` is absent on purpose: it
// never renders in the dock.
export const SECTION_ORDER: AppCategory[] = ['system', 'library', 'tools', 'create', 'deliver']

/** Every dock app, flattened into the exact left-to-right order the dock lays out. */
export function dockOrderedApps(): AppConfig[] {
  return SECTION_ORDER.flatMap((category) => APP_REGISTRY.filter((a) => a.category === category))
}

export function getAppConfig(appId: string): AppConfig | undefined {
  return APP_REGISTRY.find((a) => a.id === appId)
}
