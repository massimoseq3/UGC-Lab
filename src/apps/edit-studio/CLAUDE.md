# Edit — `edit-studio/`

Create section of UGC OS. This file loads when Claude works with files under `src/apps/edit-studio/`; the app-wide rules stay in the root [CLAUDE.md](../../../CLAUDE.md).

## Job

Download + setup page for the `/video-editor` Claude skill (script + voiceover + B-roll in → finished captioned 9:16 ad out, edited locally by Claude Code — no kie.ai involvement). Hero is a hover-animated ivory folder (`SkillFolder.tsx`, orange glow, work-cards rise out on hover) that downloads `public/video-editor.skill` (keep that copy in sync with the source skill); beside it, a 4-step setup card in the ApiKeyGuide style — **one line per step**, no reassurance paragraph and no second Claude Code link (step 1 is already one); the card is read once and in the way every time after. It sits on the Dashboard's **space wallpaper** (`components/DesktopWallpaper`, unchanged and unparameterised — see the Dashboard row) — the two full-page screens with no panels of their own share one sky — so the setup card is cut from the same glass as the widgets (translucent fill + backdrop-blur, white in light mode) rather than a flat tinted panel. Slug `/edit`; crab: Snips · Editor (clapperboard).
