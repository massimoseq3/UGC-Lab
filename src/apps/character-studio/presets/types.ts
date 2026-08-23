// One starter character shipped with the app.
//
// Built by `scripts/build-character-presets.py` into `public/presets/
// library.json`, one 400px cover each under `public/presets/thumbs/`. Static
// files rather than bank rows for the same reason as the Outlier Vault: the
// starters are identical for every member and read-only, so a synced copy
// would be 76 rows of the same thing per account.
export interface StarterPreset {
  id: string
  // The card's label — "Kitchen Female 2". Built from the two things the
  // picker filters by, numbered within its scene + gender group, because the
  // picture already shows you the braided blonde on the sofa; what a name has
  // to say is where this one sits in a library you scan by scene.
  name: string
  // The descriptive name the DNA export carries ("Braided Blonde on the
  // Sofa"). Not on the card, but it is the tooltip and it is searchable.
  title: string
  // Curated scene facet — "Kitchen", "Car", "Bathroom GRWM". Derived at build
  // time from the source folder's own numbering, not from the profile's
  // free-text `location` (43 distinct values across 76 characters).
  setting: string
  gender: string
  shotType: string
  // The shot's own note — what this framing is good for. Rides on the card as
  // its tooltip.
  note: string
  // Flat 29-key field map, ready to drop straight into the form.
  profile: Record<string, string>
}
