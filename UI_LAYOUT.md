# UI_LAYOUT.md — UGC OS interface map

A spatial reference for the rendered UI, so an automated session can locate a
control without guessing. Every claim here is grounded in the JSX; `file:line`
anchors are given so it stays verifiable when the code moves. Source code is the
source of truth — if a label here disagrees with the code, the code wins and
this file is stale (fix it).

**Reading the geometry words.** "Left/right" = horizontal position in a pane;
"top→bottom" = vertical render order; "leading/trailing" inside a row = start/end
of a flex row. Desktop (`md`+) layout is described first; every app collapses to a
single stacked column below `md`, with the generate button pinned to the bottom of
the viewport (`fixed bottom-0 … md:static`).

---

## 1. Global frame

macOS-style shell: a thin **menu bar** pinned top, a floating **dock** pinned
bottom-center, and the active app inside a rounded, bordered **window** floating
between them. `src/App.tsx:102` → `Workspace`.

```
┌─────────────────────────────────────────────────────────────┐
│ MENU BAR   logo · UGC OS · <active app>     credits · links  │  fixed top (h-9)
├─────────────────────────────────────────────────────────────┤
│    ┌───────────────────────────────────────────────────┐    │
│    │  ACTIVE APP  (rounded window; desktop gradient      │    │
│    │  peeks around it; empty state until an app opens)   │    │
│    └───────────────────────────────────────────────────┘    │
│              ┌──────── DOCK (floating) ────────┐             │  fixed bottom-center
└──────────────┴─────────────────────────────────┴────────────┘
```

- The **window** is `absolute inset-x-2 top-11 bottom-[108px]` — a rounded,
  bordered, blurred frame; app chrome clips at its edge instead of butting against
  a gutter (`App.tsx:122`).
- Apps are code-split and kept mounted once opened, toggled by opacity, so all
  open apps share the window rectangle and switching back is instant
  (`App.tsx:133`). No app active → centered **empty state** ("Pick a tool from the
  dock to get started").
- The old left **sidebar + mobile burger drawer are gone** — the dock is the sole
  navigation at every screen size (it scrolls horizontally when it can't fit).
  `Sidebar.tsx` / `auth/UserMenu.tsx` still exist as files but are no longer
  rendered anywhere.
- Toasts render bottom-stacked via `ToastContainer` (`App.tsx:157`).

### 1.1 Menu bar — `src/components/MenuBar.tsx`

Thin (`h-9`) top chrome — branding + status only, **no navigation**. Left→right:

- **Leading:** app logo + "UGC *OS*" wordmark (a **button** — clicking it reopens
  the **Meet your team** intro, macOS "About This Mac" style), then the **active
  app's name** (like macOS naming the frontmost app beside the logo).
- **Trailing:** a **Meet your team** button (explicit twin of the wordmark click),
  then a **streak** chip (flame + "N day streak", only while a generation streak
  is live; click opens the Dashboard), then the **credits** balance ("`<n>` credits left"; coin glyph swaps to a
  spinner, click refreshes — polls on mount + 60s + window focus; shows "—" until a
  kie.ai key is set), then external links **Get Credits** (kie.ai billing) and
  **Community** (Skool). These trailing items are `sm:`+ only — hidden on phones.
  At the far right, an icon-only **theme** toggle (moon/sun, dark↔light quick
  switch; System is Settings-only) — always visible, phones included.

### 1.2 Dock — `src/components/Dock.tsx`

Floating glassy rounded bar, bottom-center. Left→right, app tiles grouped by
category with inset hairline **dividers** between groups (`SECTION_ORDER =
system · library · create · tools`, order from `APP_REGISTRY`, `constants.ts`):

- **System:** Dashboard (green; also the default landing page — fresh visits
  redirect to `/dashboard`).
- **Library:** Bank.
- **Create:** Characters · Scripts · Voiceovers · B-Roll · Edit (Edit closes the
  group — cut what you produced).
- **Tools:** Ad Analyzer · Playground.
- divider → a **Settings** tile (opens the Settings modal). The theme quick
  toggle lives in the menu bar's top-right corner, not here.

Each item is a colored macOS-style app icon (accent fill + sheen) over an
always-visible label, with a running/active **dot** underneath. Hover gives a
subtle lift and **cross-fades the tile glyph to the app's crab persona sprite**
(label text never changes; roster in `src/utils/team.ts`, tooltip shows "Name ·
Role"); there is **no click-press animation**. While an app has a generation in
flight the dot **pulses in the app's accent** (apps report via
`useReportActivity` into `stores/activityStore.ts`; lazy-mounted apps only
report once opened that session). **Admin is not in the dock** (its
`category: 'admin'` is excluded from `SECTION_ORDER`) — it lives in Settings.

Note the **two namespaces**: dock display names vs the internal app/folder ids
(`constants.ts:30`). `Bank`→`finder`, `Characters`→`character-studio`,
`Scripts`→`script-architect`, `Voiceovers`→`voice-studio`, `B-Roll`→`broll-studio`,
`Ad Analyzer`→`ad-anatomy`, `Edit`→`edit-studio`.

### 1.3 Settings modal — `src/components/SettingsModal.tsx`

A **two-pane** centered modal (max-w-3xl, fixed 520px tall so the rail doesn't
jump between panes), opened from the dock's Settings tile. LEFT: a recessed
(`bg-surface-0`) nav rail — "Settings" heading over rounded-full section pills,
one per pane, each icon + label; the kie.ai row carries an amber dot while no
key is saved. RIGHT: an `h-[57px]` header (active pane's icon + name, ✕ at the
right) over the scrolling pane body. Below `sm`, the rail becomes a horizontal
scrolling pill strip above the pane and the modal grows to its content.

Panes, in rail order — each is built only when it applies, and the active id
falls back to the first pane when one disappears (sign-out drops Account):

1. **kie.ai key** (landing pane) — card with "API key" label + "Get key" link,
   masked input with eye toggle, saved/not-saved status dot, then a row of
   **Test connection** + **Save**; test result banner under it. One line of
   "stored only in this browser" copy below the card.
2. **Account** (cloud + signed-in) — avatar + name + email card, "What should
   we call you?" field with inline Save, **Sign out**.
3. **Appearance** — the Dark / Light / System segmented toggle, nothing else.
4. **Storage** (cloud mode only) — usage bar card + cleanup card (confirm →
   scan → purge).
5. **Admin** / **Advanced** (admins, or local/localhost dev) — the "Open Admin
   panel" row, the **only** entry point to the Admin app now that it's out of
   the dock, plus the demo-data load/remove tool.
6. **About** — the legal links (Terms · Privacy · AUP · DMCA) as a stacked
   list, each opening in a new tab.

### 1.4 Meet your team intro — `src/components/MeetTheTeam.tsx`

Centered onboarding modal ("Meet your *team*") framing the eight dock apps as
a named production crew (roster data in `src/utils/team.ts`) — one pixel-art
crab mascot per app (`src/components/CrabSprite.tsx`), each in a role costume,
labelled "Name · Role" (kept to a single line — `whitespace-nowrap`, card
width sized to the longest label): Bank = Sandy · Studio Manager (green
visor), Characters = Clawdia · Casting Director (shades), Scripts = Pinchy ·
Copywriter (pencil), Voiceovers = Echo · Voice Talent (headphones), B-Roll =
Bubbles · Videographer (backwards cap), Playground = Sebastian · Creative
Director (beret + paint), Ad Analyzer = Scout · Strategist (magnifying glass),
Edit = Snips · Editor (clapperboard).
Cards sit in dock order on accent-tinted tiles; clicking one opens that app.
Below the roster, a compact horizontal **fuel row** — a golden sun-rayed `kie`
crab variant + "kie.ai credits keep your team fed" + three one-line steps (get
key → paste in Settings → top up via Get Credits) — sized so the modal fits
without scrolling. **Auto-opens once per browser** (`ugc-lab:team-intro-seen`
in localStorage, state in `appStore.teamIntroOpen`); reopens from the menu bar
wordmark, the menu bar's "Meet your team" item, or Settings → Your team.
Dismiss via ✕, backdrop, Escape, or the "Let's get to work" button.

### 1.5 Shared control idioms

- **SegmentedToggle** (`src/components/SegmentedToggle.tsx`) — the house tab/pill
  control used for nearly every mode switch and Output/History tab. Rounded-full
  track, equal-width segments, a sliding active pill. When you read "tabs" or "a
  toggle" below, it's this component, and the **left-to-right option order is the
  array order** in code.
- **Model picker** (`src/components/ModelPicker.tsx`) — a pill button (model
  icon + name + credits + chevron) that opens an **inline dropdown anchored to the
  pill** (`absolute … bottom-full`/`top-full`, opens upward in footers, scrollable
  ~360px). The dropdown is a list of model rows: icon + name + credits + a check on
  the active model. It is **NOT** a right-edge slide-over. Verified in Characters
  (Nano Banana 2 / GPT Image 2 ✓ / Seedream Lite); same component in B-Roll's card
  modal and Playground.
- **Preset / style / voice / bank-ref slide-overs** — the Characters scoped preset
  pickers ("Physical Presets" / "Scene & Pose Presets"), "Select a style", "UGC
  Prompt Presets", the voice picker, and "Select from bank" pickers open as
  **right-edge slide-over panels** (roughly the right half of the viewport, ✕
  top-right), with a titled header and a card grid (e.g. a STARTERS recipe grid over
  a BANK section). These are distinct from the model-picker dropdown above.
- **Generate button** — every Create/Tool app's primary action is a full-width
  pill at the **bottom of the left control column**, accent-filled in the app's
  family color, with the credit cost in the label.
- **Panel header band** — every two-pane app puts a `h-[57px]` bar with a
  `border-b border-ink/5` at the top of **both** columns, so the two hairlines
  land on the same pixel. It holds the app's mode toggle / tab strip, and it
  renders even when a pane is empty.
- **Media tile hover actions** (`src/components/tileActions.tsx`) — every
  generated image/video tile in the app gets the same vertical top-right column:
  32px circles on a `bg-black/55` scrim (no backdrop-blur — it stutters while
  the stack fades in), in the order **[Star] → Download → Save → Copy →
  [context extras] → Delete**. `TileActionStack` positions it,
  `TileActionButton` is one action, `TileStarButton` is the bank-only star (it
  stays visible once set), and `TileDeleteButton` is the delete.
- **Destructive actions are two-click, never a modal** — `TileDeleteButton`
  arms on the first click into a red "Confirm" pill and reverts after 3s. Its
  `variant` switches skin only (`media` over artwork, `chrome` on panel
  surfaces like history rows); the interaction is identical everywhere.
- **Escape closes every dismissible overlay** (`hooks/useCloseOnEscape.ts`),
  and every one also closes on a backdrop click. Body-portaled overlays
  additionally call `useCloseOnAppSwitch`.
- **"New", not "Clear"** — the `ClearAllButton` pill at the top of each input
  column resets **inputs only**. Generated outputs and history are never
  touched, which is why it isn't labelled "Clear".
- **No focus ring**, deliberately — a global `:focus-visible` outline was tried
  and reverted (it fires on click for text inputs, boxing every search field).

---

## 2. Bank (Finder) — `src/apps/finder/`

Single full-width column: a header toolbar over a scrolling card area.
`Finder.tsx:215` (header), `:270` (content).

### Header toolbar (`Finder.tsx:215`, `lg:justify-between`)

- **Leading (left):** bank-type tabs, left→right: **Products · Characters ·
  Scripts · Voices · B-Rolls · Visual Styles** (each with a count badge).
  `Finder.tsx:217`.
- **Trailing (right):** in order — **Sort** control (pill+chevron, e.g. "Newest
  first"; only when the active bank has items) → **Bulk add** (Products bank only)
  → **Add** (filled pill, always). `Finder.tsx:229`–`262`.

### Card area (`src/apps/finder/BankList.tsx`)

- **Products** — square cards, `grid-cols-2 → 5`. Status dot top-left
  (orange=draft / green=confirmed / "Extracting" badge), title on a bottom
  gradient, download + star + delete top-right on hover.
- **Characters (models)** — portrait `9/16` cards, dense masonry `grid-cols-2 →
  6`; landscape sheets span 2–3 cols (`aspect-video`). Badges top-left ("Sheet" /
  "Preset"), copy-JSON + download + star + delete top-right.
- **Scripts** — tall `9/16` text cards `grid-cols-2 → 4`: a SCRIPT/SCENES badge +
  title at top, faded body preview, product + date footer, star + delete top-right.
- **Voices** — NOT a grid; a vertical list of rounded-full horizontal pills (mic
  avatar + label + voice name + stability), delete trailing.
- **B-Rolls** — portrait `9/16` dense grid `grid-cols-2 → 6`, grouped under date
  pills; download + star + delete top-right on hover; "Animate in Playground"
  pill appears on hover (stills only).

Star buttons (products / characters / scripts / b-rolls) are hover-revealed but
stay visible (filled amber) once starred; starred items sort first in every bank
picker slide-over, marked with a small amber star badge.

### Add/Edit Product form (`src/apps/finder/ProductForm.tsx`)

Header (title + ✕). Two columns on `lg`: **left** = square product image (with
Change / Download overlays, or a dashed drop-to-autofill box); **right** = fields,
top→bottom: **Product Name\*, Description\*, Target Market, Pain Points, USPs,
Benefits, Offer, CTA**. Sticky footer holds the submit button ("Add Product" /
"Save Changes").

---

## 3. Characters (Character Studio) — `src/apps/character-studio/`

**Two panes** split 50/50 (`CharacterStudio.tsx`): **left = controls**, **right =
output gallery**. (The dock/bank label is now **Characters** — the internal app id,
folder, and types keep the `character` naming.)

### Left controls (`components/ControlsPanel.tsx` + `GenerateBar.tsx`), top→bottom

1. **Field-group tabs** — segmented toggle with **exactly two** options:
   **Physical** and **Scene & Pose** (`ControlsPanel.tsx:201`). Clicking scroll-jumps
   to that tab's field block; an IntersectionObserver keeps the active tab in sync
   as you scroll.
   - ⚠️ **Camera is NOT a top-level tab.** It is a field *group within Scene &
     Pose*, alongside Pose & Action and Setting. Physical contains the Identity /
     Eyes / Hair / Face & Skin / Wardrobe groups.
2. **Scrollable field blocks** — every tab's block opens with a **TabDivider** (a
   centered pill on a full-width rule, `ControlsPanel.tsx:234`): **Clear** on the
   left, a **scoped preset picker** in the center (**Physical Presets** / **Scene &
   Pose Presets** — each loads only that tab's fields from a saved preset, opening a
   right slide-over), and a **scoped Copy** on the right (**Copy Physical** / **Copy
   Scene & Pose**). Below it, each field group renders as its own card: centered
   icon + title, then a two-column grid of `ChipField`s ("wide" fields span both).
3. **Generate bar** (`components/GenerateBar.tsx`), pinned bottom, top→bottom:
   - **Preset + photo row** — a **"Load Character Preset"** row (left, restores a
     full saved recipe) + a dashed **"Drop an image to autofill"** zone (right,
     vision-based DNA extraction). Both are single-line rows, no hint text.
     `GenerateBar.tsx:91`.
   - **Output toggle** — **Portrait** / **Character Sheet** (`GenerateBar.tsx:107`).
   - **Model picker row** — model picker (fills the left half) + a **resolution**
     chip + an **aspect-ratio** chip (9:16 / 16:9 / 1:1; sheets get their own
     16:9↔9:16 picker).
   - **Generate button** — pink (`bg-influencers-500`), full width: "Generate
     Character" / "Generate Character Sheet" + credits.

Characters defaults to the **GPT Image 2** model (app-wide image default is Nano
Banana 2).

### Right gallery (`components/GalleryPanel.tsx`)

Scrolling, newest-first, grouped under date pills ("In progress" / "Today" /
date). Grid `grid-cols-2 → lg:3`, `grid-auto-flow:dense`; **16:9 outputs span the
full row** (`col-span-2 lg:col-span-3`). Each tile: badges top-left (Sheet/Saved),
delete top-right on hover, a bottom hover toolbar (edit / make-sheet on the left,
save / download on the right), model caption underneath.

- **Lightbox** (`InfluencerLightbox.tsx`): fullscreen; ✕ top-right, image centered,
  prompt + Copy/Download centered below.
- **Edit modal** (`InfluencerEditModal.tsx`): left editor (mode toggle, model
  picker, prompt, reference uploads, generate) + right outputs strip; ✕ top-right.

---

## 4. Scripts (Script Architect) — `src/apps/script-architect/`

**Two panes** 50/50 (`ScriptArchitect.tsx:222`): **left = input**, **right =
output**.

### Mode tabs (top of left pane)

Left→right: **Remix · Write New** (the old Remix Script / Remix Scenes tabs are
merged into one Remix mode — the source box auto-detects the pasted format).

### Left input, top→bottom by mode

- **Remix:** one merged source box (bank card header + paste textarea) →
  Product Context → Additional Context (optional). When the pasted text is a
  scene blueprint (`--- Scene N` / `SCENE N —` headers) the box flips to
  fuchsia + monospace and a footer chip appears: "Scene blueprint detected —
  scenes will be rewritten" with a **Remix as script instead** override button
  (toggles back via "Rewrite scenes instead").
- **Write New:**
  1. **Output** sub-toggle — left→right **Script · Hooks · Scenes** (a fourth
     **Cinematic** option was retired).
  2. **Product Context** card (+ "Edit product details" link).
  3. **Script Style** picker — *replaced by the **Hook Style** picker when
     Output = Hooks* (a slide-over with **Best Mix** (auto, default) + the 7
     hook families: Educational · Comparison · Myth Busting · Storytelling ·
     Authority · Day in the Life · Pattern Interrupt; the X on a chosen family
     resets to Best Mix).
  4. **Describe Your Ad** textarea (the brief; optional).
  5. **Length** toggle — 10s / 15s / 20s / 30s / 60s (hidden entirely for Hooks
     — they're one-liners).

**Generate button** (pinned bottom): label varies — "Generate 3 Scripts" /
"Generate 10 Hooks" / "Generate 3 Scene Drafts" / "Generate 3 Script Variations"
/ "Rewrite Scene Prompts".

### Right output (`components/OutputPanel.tsx`)

Top: **Output / History** tabs (`RightPanel.tsx:59`). Output = a vertical stack of
result cards; each card has a title/scene-count badge (left) + Copy (right) header,
then a wrapping action-button row. Button order (`OutputPanel.tsx:275`):

- **Save to Bank** (always, leading).
- Then conditionally: **Send to Voiceovers** (spoken scripts) · **Send to B-Roll**
  (always) · **Send to Playground** (scene formats). A Hooks pack gets no send
  buttons — each row is its own opener with a per-hook Copy, plus a Copy All in
  the card header.

(The June screenshot's "Send to Characters" is stale — no such button exists.)

---

## 5. Voiceovers (Voice Studio) — `src/apps/voice-studio/`

Three regions (`VoiceStudio.tsx:253`): **left side panel** (fixed `w-[400px]`) +
**editor** (flex-fill, to its right) + a **bottom player** bar that appears when
a clip is playing. On mobile the two stack with the editor on top (`order-first`).

### Editor (`components/EditorArea.tsx`), top→bottom

A `h-[57px]` header band holding the **New** reset pill (`ClearAllButton` —
clears the picked script + pasted text; every generated voiceover stays in
History), aligned with the side panel's Settings/History strip. Then: script
bank selector (pill / dashed "Click to select from bank") → "or paste script
manually" divider → large textarea → progress bar → **footer row**: character
counter (leading) · model chip + **Generate Voiceover** button (trailing).

### Side panel (`components/SidePanel.tsx`)

Header band: the **Settings / History** tab strip. Settings (`SettingsView.tsx`),
top→bottom:

1. **Preset** row — loads a saved `voices` bank entry (scrolls with the column).
2. **Voice** selector (avatar + name + description; opens the voice picker
   slide-over).
3. **Style** dropdown (Vocal Smile / Newscaster / Whisper / Empathetic /
   Promo·Hype / Deadpan).
4. **Pace** + **Accent** dropdowns, side by side.
5. **Expressiveness** slider (the `temperature` param, Focused → Creative).
6. **Tone / context** then **Scene** textareas, both tagged with an `OPTIONAL`
   pill (the one-tap direction presets that used to sit under them are retired).
7. A **Reset** pill closing the column, toned like the shared "New" pill.

Subheadings are one shared size (`SETTING_LABEL`, 13px) over 13px value text and
11px subtext — the editor's Script card matches those same three sizes.

The engine is **Gemini 3.1 Flash TTS**, not ElevenLabs — the model name shows on
the generate row's chip, and there is no model picker.

**Voice picker** (`VoicePickerView.tsx`): slide-over with a "Select a voice"
header (back arrow), search box + category chips, then a scrolling list of rows
(play-button avatar + name/category + selected check).

### Bottom player (`components/BottomPlayer.tsx`), left→right

Voice avatar + script preview + voice name/time (≈28% width) → back-10s · play/pause
· forward-10s → current time → scrubber → duration → details (AlignLeft) · download ·
close (ChevronDown).

---

## 6. B-Roll (Broll Studio) — `src/apps/broll-studio/`

**Two panes** split **25 / 75** (`BrollStudio.tsx:371`): narrow **left input**
(`md:w-1/4`), wide **right scenes** (`md:w-3/4`).

### Mode toggle (left panel header, 57px bar)

Two-way `SegmentedToggle`, left→right: **Line-by-Line** (rows) · **Continuous**
(box). Whether the cards speak is not a mode — that's the **B-Roll Clips / With
Dialogue** toggle at the top of the settings band, shown only in Line-by-Line.
Both Generate buttons carry an estimated-credits pill. (A third mode,
**One-Shot**, was retired — see `types.ts:BrollMode`.)

The **References** eyebrow row below it ends in a pair of matching grey pills,
left→right: **Import prompts** · **+ New** (`ClearAllButton`). Import prompts
opens `ImportPromptsModal` — a centred popup: *1 · Copy the brief* (Copy brief /
Download as file) over *2 · Paste what it gives you back* (mono textarea +
Upload a file + drop target), a live parse summary underneath, then
Cancel · **Import prompts** in the footer.

**Continuous** is the keyframe-chain mode (`ContinuousView.tsx`): the left panel
adds a **Visual Style** chip row (3D Animated / Claymation / Papercraft / Anime
/ Cinematic / UGC Realism) plus a dashed **Match a reference style** box —
thumbnails + an add tile (max 4) + an *Analyze style from N images* button;
once analysed, a "Custom style locked" card shows the distilled brief and the
preset chips grey out until it's cleared. There is deliberately **no video model
picker here** — it lives in the clip modal. The Generate button reads **Generate
Storyboard**.

The right panel's first tab is then labeled **Storyboard**: a meta strip
(scene count · style · total seconds · keyframes-picked counter) with
**Generate frames** + **Generate all clips** buttons, then one row per scene —
big italic number + "Scene N" chip + the quoted line, a grid of **3 concept
cards** (Option pills; the chosen keyframe gets a broll-accent ring + "Keyframe"
badge; hover = Generate / Use) + an **Add concept** dashed card + a tinted
**Clip N** card (shows "Pick keyframes…" until both ends exist, then the start
frame + "Keyframes ready", then the hover-play video). A closing **Final
Frame** row holds concepts only.

Concept cards open `ContinuousFrameModal` — the same controls as the
Per-line card's Image tab: image `ModelPicker` → style note →
chain/character/product ref cards → extra-refs row → prompt with
**Enhance · Regenerate · Undo · Redo** → footer resolution/aspect chips →
**Generate Image** + credits; the right column is the image gallery, where
clicking a tile makes it the keyframe. Clip cards open `ContinuousClipModal`
(frames-capable **video model picker** · start/end thumbs · style note · motion
prompt · resolution/duration/audio chips · Generate Video + credits · video
gallery). Both batch buttons confirm first (clips show summed credits + balance).

### Left input (`components/InputPanel.tsx`), top→bottom

The `h-[57px]` header band holds the three-way **mode toggle** (§6 above), not a
title — it already fills that row in this narrow 25% pane. Below it, inside the
scroll area: a **REFERENCES** label + the **New** reset pill (`ClearAllButton` —
clears the three ref slots, the script text and the instructions; every
generated scene, clip and history row stays) → **Product** ref card →
**Character** ref card (each: dashed "Click to select from bank" when empty,
filled pill when set) → **Script / Hooks** ref card, tagged OPTIONAL, over its
own paste textarea — that box is `flex-1`, so it takes every spare pixel the
column has → a **BRIEF** box (labelled **INSTRUCTIONS** once a script exists),
tagged OPTIONAL, which is a plain textarea you type straight into.

The pinned settings band below opens with the **B-Roll Clips / With Dialogue**
delivery toggle (Line-by-Line only), then the two decisions that shape the
output as plain rows, the same size as the reference cards above: **Visual
Style** → **Ad Format** over a **10s / 15s / 20s / 30s / 60s** length toggle
that appears only while the script box is empty → **Generate B-Roll / Dialogue
/ Storyboard Prompts** button. Both rows are dashed until picked; there are no Required tags,
because the button greys out until both are chosen. The Ad Format slide-over
pins a **Standard UGC** card above the Formats and Structures sections. The one
line under the button, "Writes a 30s script first, then storyboards it", shows
only while the script box is empty.

### Right scenes (`components/RightPanel.tsx` → `ScenesView.tsx`)

Top tabs: **Scenes / History**. Scenes view: a control bar with the scene count
(left) and a **Generate all images** button (right), then scene blocks
(`gap-10`). Each scene block:

- Header: big italic scene number + "Line N" chip + the quoted script line (left);
  a **Generate all** button for that scene (right). The quoted line is a button —
  clicking it opens `SceneLineEditModal` (textarea + Cancel / **Save line**), and
  saving swaps the quoted words in that scene's prompts with no LLM call.
- A grid of **3 variation cards** plus an **Add option** card:
  `grid-cols-2 → md:3 → xl:4`. At `xl` the three cards plus Add option fill one row
  as four equal cells; Add option is a normal dashed card in the grid, not a strip.
  (Sessions generated before the cut from four variations still render — the extra
  card just wraps onto a second line.)
  Seven selectable variation tags (`ALL_TAGS` in `services/generateBroll.ts`):
  **Action · Emotional · Product shot · POV · Environment · Transition · Proof** — a
  colored chip top-left of each card (lime / pink / amber / violet / teal / sky /
  orange). Under **With Dialogue** all three cards carry the `Dialogue` tag instead —
  it's outside `ALL_TAGS` (the silent menu) but emitted wholesale by the delivery
  override. `Static` survives in the `VariationTag` union so older persisted
  sessions still render; nothing produces it any more. The bottom-center
  caption reads **A-Roll** (the two legacy tags) or **B-Roll** (everything else).
  - Cards render in the LLM's per-line generation order, then any manually added
    cards. `displayOrder` (ScenesView) sorts the render only.

Each card (`VariationCard.tsx`, portrait `9/16`): tag chip top-left (or a neutral
**Custom** chip on a manually added card); status badges top-right, replaced on hover
by a vertical action stack **Download · Save to B-Rolls (stills only) · Copy Prompt ·
Delete** (delete is two-click, flipping to a red "Confirm"). Bottom-left holds the
play/mute pair on a video cover, or the "Click to set up" nudge. Bottom-right, on
hover: **Image · Video** — shortcuts that open the detail modal straight onto that
tab (`initialTab`), so the common trip (open → switch to Video → generate) is one
click. They're text-only because adding icons widened the pair into the nudge and the
mute button. Clicking the card body opens the modal on Image, as before.

### Card detail modal (`components/CardDetailModal.tsx`)

✕ top-right; header tag chip + "ROLLTYPE · Scene N". Body is a 50/50 grid:

- **Left:** **Image / Video / Animate** tab toggle → model picker + constraint
  chips (resolution, aspect, and for video: duration + audio) → **Reference Images**
  (two slots: Character left, Product right) *or* the Animate start-frame preview →
  Prompt (with Enhance · Regenerate · Undo · Redo) → **Generate Image / Generate
  Video / Animate** button.
- **Right:** a masonry gallery of this card's generations.

### Right history (`components/BrollHistoryView.tsx`)

The other half of the Scenes / History tab pair. Header block: full-width search
field, then mode filter pills (All · Line-by-Line · Continuous — only when more
than one mode is present, preceded by an "N sessions rendering" chip while
anything is in flight) on the left with the sort dropdown (Newest / Oldest /
Recently updated) on the right.

Below it, a **card grid** (`1 → sm:2 → xl:3 → 2xl:4`) sectioned by day, each
section led by a left-aligned "TODAY / YESTERDAY / date" label + item count + a
hairline. Each card: a 16:10 **cover mosaic** of up to three of that session's
own stills/clips (1 full-bleed, 2 split, 3 as big-left-plus-stacked-pair; a film
glyph when the session has no media yet), with the mode badge top-left, scene
count + visual-style pill bottom-left, and the two-click delete top-right on
hover. Under the cover: a two-line title (product · influencer · script) and a
meta line — "6 stills · 2 clips · 3h ago", or a live "Generating N images…" chip
plus a red "N failed" marker while work is in flight. Clicking a card loads that
session and flips to Scenes.

---

## 7. Playground — `src/apps/playground/`

**Two panes** (`Playground.tsx:523`): **left control panel** (`md:w-1/3`,
min-380px) + **right history grid** (flex-fill).

### Mode tabs (top of left, `PromptPanel.tsx:120`)

Left→right: **Video · Image · Music**. The fresh default is **Video**
(`Playground.tsx:101`, `mode: 'video'`); the panel then **restores the last-used
mode from the persisted draft**, so a returning session may open on Image or Music.

### Left panel, top→bottom (varies by mode)

Every mode is: model picker → attachment row (model-dependent) → **Prompt** (a
"UGC Prompt Preset" header row that opens the presets slide-over, the textarea
with the `@`-mention popover, then an Enhance Prompt / Clear Prompt / Undo / Redo
+ Expand footer) → pinned bottom footer: constraint chips → **Generate**.

The **attachment row** is one wrapping 36px bar (`components/video/RefSlot.tsx`):
each input the model accepts is a dashed pill (icon + label + `count/max`), and
whatever is attached to it follows immediately as a chip or a square thumbnail.
Clicking an image pill opens Upload / Pick from Bank.

- **Image:** Reference Images (≤4).
- **Video:** Start Frame / End Frame (End dimmed + "not supported" off
  frames-to-video models), Reference Images (≤9, or Omni's remaining quota),
  Reference Audio (≤15s) / Reference Videos (≤15s) on the Seedance 2 family, and
  on **Gemini Omni** Characters (≤3) / Voices (≤3) / Source Clip (with a trim
  window `start → end s` beside the clip chip). **Motion Control** models replace
  the row with Character Image + Driving Video + an orientation toggle and a
  caption line. Footer chips: resolution + aspect + duration + **Audio**.
- **Music:** **Instrumental / With lyrics** toggle. (No attachment row.)

### Right history grid (`components/PlaygroundHistoryGrid.tsx`)

Scrolling, newest-first, date-bucketed; masonry `grid-cols-2 → lg:3 → xl:4`,
landscape items span 2 cols. Image/video/audio tiles with hover actions (reuse,
save-to-B-Rolls for images, download, delete) + model caption; click opens a
centered preview lightbox (with Send-to-inputs / Save / Download, and for video a
first/last frame-grab row).

---

## 8. Ad Analyzer (Ad Anatomy) — `src/apps/ad-anatomy/`

Root is a horizontal flex (`AdAnatomy.tsx:158`). Three columns once a result is
open:

1. **History rail (far left)** — `HistoryRail.tsx`. A red **New analysis** button
   at the **top**, then the list of past analyses.
2. **Media column (center, `md:w-1/3`)** — the video/image player + filename chip
   (only when the analysis has media).
3. **Results column (right, flex-fill)** — `ResultsView.tsx`, with a sticky
   section-jump toggle (**Breakdown · Transcript · Scenes**), top→bottom:
   - **Breakdown** — one card: the scorecard on top (scored dimensions in this
     fixed order: **Hook Strength, Structure Clarity, Visual Variety,
     Persuasion Depth, Overall Execution**, analyst's note to the right), then
     under an inset divider the Hook / Angle / Structure blocks and the
     copyable **Script Style Prompt** (product-agnostic writing brief; saves to
     the Script Bank with a STYLE badge). Legacy results that predate the
     creative breakdown show only the scorecard part.
   - **Transcript**.
   - **Reverse-Engineered Scenes**.

Under the Breakdown, Transcript, and Scenes sections sits a shared action row
(`ResultsView.tsx`), left→right: **Save to Script Bank · Send to Scripts**
(hidden on the Breakdown card for legacy results with no style prompt).

The pre-result **upload state** (`UploadView.tsx`) shows the drop/upload target
instead of the media+results columns.

---

## 9. Edit — `src/apps/edit-studio/`

No panes and no in-app generation — a download + setup page for the
`/video-editor` Claude skill (script + voiceover + B-roll in → finished
captioned 9:16 ad out, edited locally by Claude Code on the member's machine).
Centered `max-w-5xl`, two columns on `md:` (stacks below), vertically centered
(`EditStudio.tsx`):

- **Left column:** the **skill folder** (`SkillFolder.tsx`) — an ivory
  macOS-style folder illustration (accent `#F77646`) with an orange radial glow,
  the app's editor crab (Snips, clapperboard) on an orange icon tile, and a bold
  `/video-editor` label on the front pocket. The whole folder is one download
  link for `public/video-editor.skill`; hovering lifts the folder a touch and
  three work-cards (16:9 video frame left, "FULL SCRIPT" card middle, orange
  waveform right) pop up over the top edge as a tight overlapping fan — the
  folder body itself does not morph. Below: a black **Download skill** pill
  (same link) over a
  "video-editor.skill · 20 KB" caption. The folder keeps literal ivory/orange
  colors in both themes (it's artwork, like user media).
- **Right column:** "Your AI video editor" serif display header + one-paragraph
  pitch, then a **Set it up** card with 4 numbered steps in the ApiKeyGuide
  style, written plain (no jargon, no em dashes, ~6th-grade) for non-technical
  members: install Claude Code → download the skill → in Claude open Settings ›
  Customize › Add › Upload a skill → open Claude Code in a new folder named "Ad
  Editor", run the skill and point it at the voiceover + B-roll. A footnote
  (no editing apps needed, self-setup on first run, files stay local), and
  a trailing "New to Claude Code? Start here" external link.

## 10. Dashboard — `src/apps/dashboard/Dashboard.tsx`

One page, no panes or tabs, staged as a **desktop in space**: a wallpaper of
colour blooms + starfield (`DesktopWallpaper.tsx`), the widget wall on the left,
the crew orbiting as a solar system on the right. First tile in the dock (green)
and the **default landing page** (`DEFAULT_SLUG = 'dashboard'`). It is built to
sit inside one window with the dock — **nothing here should make the page
scroll**. Hero figures are Instrument Serif italic; every tile is cut from the
one glass material in `Widget.tsx` (`WIDGET_SHELL`).

- **Greeting header** (left column, top): "Good morning, `<first name>`"
  (time-of-day phrase; name from `profile.display_name` then `first_name`) over
  a date + one-line sub. **No quick links** — the menu bar already carries Get
  Credits and Community on every screen.
- **Connect banner:** while no kie.ai key is saved, a notification-style glass
  row (`ConnectKeyCard.tsx` — amber key tile, chevron right) sits between the
  header and the widgets; clicking opens `ApiKeyGuide`, which takes the key
  inline. It removes itself the moment a key lands.
- **Widget wall** — a 12-col grid, **two rows at `lg`**:
  - Row 1: **Time saved** (5 cols — serif hero, green "+N this week" delta,
    workdays sub-line, 14-day sparkline) · **Money saved** (4 cols — serif hero
    USD, delta, "N credits" note top-right, kie-vs-elsewhere bar) · **Streak**
    (3 cols — `StreakRing.tsx`, the closing ring, with "days in a row · best N"
    under it).
  - Row 2: **Activity** (9 cols — 26-week GitHub-style heatmap,
    `ActivityHeatmap.tsx`, Monday-first columns, month labels above, native
    `title` per cell, intensity legend on its right; caption top-right reads
    "`<n>` generations · `<n>` active days since `<month>`") · **AI UGC
    Academy** (3 cols — external link tile, graduation-cap glyph,
    `ArrowUpRight` top-right).
  - Below `lg` the two heroes go half-width and Streak / Activity / Academy each
    take the full row.
- **Solar system** (right column, `xl` and up — `SolarSystem.tsx`): eight apps
  as planets orbiting a gold sun; click a planet to open its app, hover anywhere
  in it to freeze every orbit. One caption slot under it names whatever the
  cursor is on (app name + "Name · Role" + crab). Below `xl` it is replaced by
  `DesktopIcons` — the plain 8-tile crew grid under the widgets.

All values derive from `bankStore.usageDays` via `computeUsageMetrics`
(`utils/usage.ts`); the page is read-only. Related: model pickers (ModelPicker +
ModelSidePanel rows) show a green "**`<n>`% off**" chip after the model name for
models with verified `official` pricing in `models.ts`, and the menu bar shows a
flame streak chip while a streak is live (§1.1).

---

## 11. Admin — `src/apps/admin/AdminPanel.tsx`

Admin-only (sidebar entry hidden for non-admins). Tabs: **Members · Insights ·
Allowlist** (`MembersTable.tsx`, `Insights.tsx`, `AllowlistEditor.tsx`). Not
exercised by creator-facing tutorials; mapped here only for completeness.

---

## Maintenance

When you change a pane split, reorder tabs/buttons, rename a control, or move a
generate action, update the matching section above **and** keep the `file:line`
anchor pointing at the right place. This file exists so UI-driven automation
doesn't have to re-derive the layout from scratch — stale entries are worse than
none.
