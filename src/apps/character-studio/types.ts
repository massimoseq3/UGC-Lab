import type { ElementType } from 'react'
import { IdCard, Eye, Scissors, Smile, Shirt, MapPin, PersonStanding, Camera } from 'lucide-react'
import type { ImageResolution } from '../../utils/models'

export type TabId = 'physical' | 'scene' | 'camera'

// One running generation. Persisted to localStorage so a mid-flight refresh
// resumes polling instead of losing the job. `taskId` is the kie.ai task ref
// returned by startCharacterTask; missing while the createTask request is
// in flight, populated as soon as kie returns it. `profile` / `resolution`
// are the snapshot needed to write the history row on success.
//
// Owned by CharacterStudio for EVERY generation surface — the form, the
// gallery's "Make Sheet" action, and the edit modal alike — so closing the
// modal (or refreshing) never orphans an in-flight job.
export interface InFlightCharacterGen {
  id: string
  modelId: string
  aspectRatio: string
  startedAt: number
  taskId?: string
  resolution?: ImageResolution
  // Portrait vs character-sheet generation (undefined → portrait, pre-sheet entries).
  kind?: 'portrait' | 'sheet'
  // The CharacterProfile snapshot to write into characterHistory on success.
  profile?: Record<string, string>
  // Set when the gen belongs to an existing character's lineage (started from
  // the edit modal) so the finished row rejoins that character's strip — and so
  // the modal can re-render this tile after a close + reopen.
  lineageId?: string
  // Name of the visual style the edit modal rendered this in, stamped onto the
  // finished history row (label only — see CharacterHistoryItem.styleName).
  styleName?: string
}

// Everything a caller needs to kick off a generation through CharacterStudio's
// launcher. `edit` swaps the profile-built portrait prompt for an instruction
// applied image-to-image on top of `baseImageRef` (the edit modal's cover).
export interface LaunchGenOptions {
  profile: CharacterProfile
  resolution: ImageResolution
  kind: 'portrait' | 'sheet'
  aspect: string
  referenceUrl?: string
  lineageId?: string
  // Sheet generations started from the edit modal carry that panel's own
  // inputs: `direction` is the typed instruction and/or picked visual style,
  // `extraReferenceUrls` the attached reference images. Unset for a sheet
  // built straight off the form.
  direction?: string
  extraReferenceUrls?: string[]
  // The picked visual style's label, when it isn't the default UGC Realism.
  styleName?: string
  edit?: {
    instruction: string
    baseImageRef: string
    referenceUrls: string[]
  }
}

// The single style string used for Camera Device — keeps every generated
// character locked to the same UGC photorealism look.
export const PHOTOREALISM_STYLE =
  'Modern iPhone camera quality, unedited photorealism, matching A-roll lighting, zero bokeh, zero depth of field, sharp focus across entire frame.'

export interface FieldConfig {
  key: string
  label: string
  // Default typeahead options: focusing the field's input opens a searchable
  // dropdown of these. (Historically rendered as chip rows — the name stuck.)
  chips: string[]
  placeholder?: string
  // Optional larger typeahead list; overrides `chips` as the dropdown source
  // when present (e.g. the full ethnicity list).
  suggestions?: string[]
  // Layout hint: short fields pack two-per-row; `wide` fields (long free-text
  // or sentence-length preset values) span the full row so they don't look
  // cramped next to a one-word neighbour. See ControlsPanel's grid.
  wide?: boolean
  // Widen the typeahead dropdown beyond the (half-width) input and let options
  // wrap instead of truncate — for half-width fields whose presets are long
  // sentences (e.g. Skin & Realism). See ChipField's `wideMenu`.
  wideMenu?: boolean
}

// Searchable ethnicity/nationality list for the Ethnicity typeahead. Broad
// categories live on the quick chips; this covers the specific ones without
// cluttering the chip row. Free text still works for anything not listed
// (e.g. "French mixed with Moroccan").
export const ETHNICITY_SUGGESTIONS: string[] = [
  // Broad categories first (the old quick chips), then specifics A-Z.
  'Caucasian', 'Black', 'Asian', 'Hispanic/Latino', 'Middle Eastern', 'South Asian', 'Mixed',
  'Afghan', 'African American', 'Albanian', 'Algerian', 'American', 'Argentinian', 'Armenian',
  'Australian', 'Austrian', 'Bangladeshi', 'Belgian', 'Bolivian', 'Brazilian', 'British',
  'Bulgarian', 'Cambodian', 'Cameroonian', 'Canadian', 'Caribbean', 'Chilean', 'Chinese',
  'Colombian', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Czech', 'Danish', 'Dominican',
  'Dutch', 'Ecuadorian', 'Egyptian', 'Emirati', 'Eritrean', 'Estonian', 'Ethiopian', 'Filipino',
  'Finnish', 'French', 'Georgian', 'German', 'Ghanaian', 'Greek', 'Guatemalan', 'Haitian',
  'Hawaiian', 'Honduran', 'Hungarian', 'Icelandic', 'Indian', 'Indigenous / Native American',
  'Indonesian', 'Iranian / Persian', 'Iraqi', 'Irish', 'Israeli', 'Italian', 'Ivorian',
  'Jamaican', 'Japanese', 'Jordanian', 'Kazakh', 'Kenyan', 'Korean', 'Kurdish', 'Lebanese',
  'Lithuanian', 'Malaysian', 'Maori', 'Mexican', 'Mongolian', 'Moroccan', 'Nepali',
  'New Zealander', 'Nigerian', 'Norwegian', 'Pacific Islander', 'Pakistani', 'Palestinian',
  'Panamanian', 'Paraguayan', 'Peruvian', 'Polish', 'Portuguese', 'Puerto Rican', 'Romanian',
  'Russian', 'Rwandan', 'Salvadoran', 'Saudi', 'Scottish', 'Senegalese', 'Serbian',
  'Singaporean', 'Slovak', 'Somali', 'South African', 'Spanish', 'Sri Lankan', 'Sudanese',
  'Swedish', 'Swiss', 'Syrian', 'Taiwanese', 'Tanzanian', 'Thai', 'Tibetan', 'Tunisian',
  'Turkish', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbek', 'Venezuelan', 'Vietnamese',
  'Welsh', 'Yemeni', 'Zimbabwean',
]

export interface FieldGroup {
  id: string
  label: string
  icon?: ElementType
  fields: FieldConfig[]
}

export interface TabConfig {
  id: TabId
  label: string
  // Optional shorter label used by the segmented tab strip when the long
  // form would overflow narrow columns. Falls back to `label` if absent.
  shortLabel?: string
  groups: FieldGroup[]
}

export type CharacterProfile = Record<string, string>

export const TABS: TabConfig[] = [
  {
    id: 'physical',
    label: 'Physical',
    groups: [
      {
        id: 'identity',
        label: 'Identity',
        icon: IdCard,
        fields: [
          {
            key: 'gender',
            label: 'Gender',
            chips: ['Female', 'Male', 'Non-binary'],
          },
          {
            key: 'age',
            label: 'Age Range',
            chips: ['18-24', '20s', '25-30', '30-40', '40-50', '50-60', '60-70', '70-80'],
          },
          {
            key: 'ethnicity',
            label: 'Ethnicity',
            chips: ['Caucasian', 'Black', 'Asian', 'Hispanic/Latino', 'Middle Eastern', 'South Asian', 'Mixed'],
            suggestions: ETHNICITY_SUGGESTIONS,
            placeholder: 'Search or type...',
          },
          {
            key: 'bodyType',
            label: 'Body Type',
            chips: ['Slim', 'Athletic', 'Average', 'Curvy', 'Plus-size', 'Muscular'],
          },
        ],
      },
      {
        id: 'eyes',
        label: 'Eyes',
        icon: Eye,
        fields: [
          {
            key: 'eyeColor',
            label: 'Eye Color',
            chips: ['Brown', 'Blue', 'Green', 'Hazel', 'Gray', 'Amber', 'Dark brown'],
          },
          {
            key: 'eyeShape',
            label: 'Eye Shape',
            chips: ['Almond', 'Round', 'Hooded', 'Monolid', 'Upturned', 'Downturned', 'Deep-set', 'Wide-set'],
          },
        ],
      },
      {
        id: 'hair',
        label: 'Hair',
        icon: Scissors,
        fields: [
          {
            key: 'hairColor',
            label: 'Hair Color',
            chips: ['Blonde', 'Brunette', 'Black', 'Red', 'Auburn', 'Gray', 'Platinum'],
          },
          {
            key: 'hairTexture',
            label: 'Hair Texture',
            chips: ['Straight', 'Wavy', 'Curly', 'Coily', 'Kinky', 'Fine', 'Thick'],
          },
          {
            key: 'hairStyle',
            label: 'Hair Style',
            chips: [
              'Long straight', 'Long wavy', 'Shoulder-length', 'Bob', 'Pixie cut', 'Ponytail', 'Messy bun', 'Braids', 'Curtain Bangs + Layers', 'Short textured', 'Buzz cut',
              // Micro-realism variants — loose flyaways and baby hairs kill the
              // "too-perfect helmet hair" AI tell. Each bundles a base style
              // with the realism cue so it stays a single click. Long enough to
              // star (see ChipField's DETAILED_LEN), which is also what the
              // built-in presets pick so a loaded recipe shows the starred row
              // as selected rather than a bare word.
              'Long wavy with loose flyaways and baby hairs framing the face',
              'Messy bun with soft flyaways and stray strands at the hairline',
              'Sleek ponytail with natural baby hairs at the hairline',
              'Effortless waves with subtle frizz and natural flyaways',
              'Long straight with blunt bangs and soft flyaways',
              'Short textured crop with natural movement and a few stray strands',
              'Thick box braids pulled back, with baby hairs along the hairline',
              'Neatly combed short side part, silver-gray at the temples',
              'Soft silver bob with natural flyaways and a gentle wave',
              'Closely shaved head with fine natural stubble and visible scalp texture',
            ],
            wide: true,
          },
        ],
      },
      {
        // Skin tone/texture live here with the facial-feature fields — one
        // "face" group rather than a separate Skin section higher up, so the
        // top of the form stays light and the descriptive fields cluster.
        id: 'face-skin',
        label: 'Face & Skin',
        icon: Smile,
        fields: [
          {
            // The realism dial. The first three are one-click tiers — full,
            // self-contained skin descriptors graded by intensity. They lead
            // with a keyword ("Subtle/Natural/Gritty realism —") so they're
            // distinguishable in the truncated dropdown and read as a clean
            // instruction in the prompt. The shorter chips below stay for quick
            // picks and free text. Realistic skin texture is the single biggest
            // tell that sells "real photo" over "AI render".
            key: 'skinTexture',
            label: 'Skin & Realism',
            chips: [
              'Subtle realism — smooth, healthy skin with fine visible pores, faint peach fuzz and an even tone, a soft natural matte finish with no plastic smoothing',
              'Natural realism — realistic skin with visible pores, light freckles scattered across the nose and cheeks, subtle shine on the T-zone, realistic subsurface scattering and slight natural asymmetry',
              'Gritty realism — heavily textured skin with pronounced pores, freckles and a few small blemishes, faint acne scarring, mild redness around the nose, visible under-eye texture, fine lines and a small beauty mark',
              // The same graded tiers carried into older faces. Without these,
              // an older preset had to hand-write its skin as free text, which
              // never matched a dropdown row and so never showed as picked.
              'Mature realism — softly lined skin with visible pores, gentle crow\'s feet and smile lines, faint age spots, natural under-eye texture and warm subsurface scattering',
              'Weathered realism — sun-aged skin with deep laugh lines, coarse visible pores, uneven pigmentation, age spots and a calm, lived-in texture',
              'Glass skin finish with ultra-detailed texture, including visible skin pores, fine peach fuzz, and a scattering of light freckles across the bridge of her nose',
              'Glass skin',
              'Natural pores',
              'Natural pores with slight imperfections',
              'Freckled',
              'Acne scarring',
              'Sun-weathered',
              'Mature lines',
              'Textured',
            ],
            placeholder: 'e.g. "Natural realism — visible pores, light freckles"',
            // Half-width so it pairs with Skin Tone on one row; the realism
            // presets are long sentences, so its dropdown widens and wraps
            // (wideMenu) to stay readable despite the narrow input.
            wideMenu: true,
          },
          {
            key: 'skinTone',
            label: 'Skin Tone',
            chips: ['Porcelain', 'Fair', 'Light', 'Beige', 'Olive', 'Golden', 'Tan', 'Caramel', 'Bronze', 'Brown', 'Espresso', 'Deep ebony'],
          },
          {
            key: 'facialHair',
            label: 'Facial Hair',
            chips: ['None', 'Clean-shaven', 'Stubble', 'Short beard', 'Full beard', 'Goatee', 'Mustache'],
          },
          {
            key: 'makeup',
            label: 'Makeup',
            chips: [
              'No makeup', 'Natural/minimal', 'Skin-like natural makeup with visible skin texture', 'Dewy "no-makeup" makeup', 'Light glam', 'Full glam', 'Dewy skin', 'Bold lip', 'E-girl makeup', 'Soft glam',
              'E-girl makeup with graphic liner, soft blush and glossy lips',
              'Minimal everyday makeup — tinted balm, groomed brows, no foundation',
            ],
          },
          {
            key: 'facialFeatures',
            label: 'Facial Features',
            chips: ['Freckles', 'Sharp jawline', 'Soft features', 'High cheekbones', 'Full lips', 'Glasses'],
            placeholder: 'e.g. "Light freckles, soft smile"',
          },
          {
            key: 'distinguishingMarks',
            label: 'Distinguishing Marks',
            chips: ['None', 'Beauty mark', 'Dimples', 'Scar', 'Birthmark', 'Tattoo', 'Piercing'],
            placeholder: 'e.g. "Beauty mark on left cheek"',
          },
        ],
      },
      {
        id: 'wardrobe',
        label: 'Wardrobe',
        icon: Shirt,
        fields: [
          {
            key: 'clothingStyle',
            label: 'Clothing Style',
            chips: ['Athleisure Set', 'Casual athleisure', 'Streetwear', 'Business casual', 'Minimalist', 'Minimal chic', 'Cozy homewear', 'Gym wear', 'Boho', 'Preppy'],
          },
          {
            key: 'accessories',
            label: 'Accessories',
            chips: ['Watch', 'Necklace', 'Earrings', 'Gold hoops', 'Baseball cap', 'Sunglasses', 'Headband', 'Rings', 'None'],
            placeholder: 'e.g. "Gold necklace, hoops"',
          },
        ],
      },
    ],
  },
  {
    id: 'scene',
    label: 'Scene & Pose',
    groups: [
      {
        id: 'pose',
        label: 'Pose & Action',
        icon: PersonStanding,
        fields: [
          {
            key: 'pose',
            label: 'Pose',
            chips: ['Sitting', 'Standing', 'Leaning', 'Walking', 'Lying down', 'Cross-legged', 'Kneeling', 'Crouching', 'Front-on facing camera'],
          },
          {
            key: 'expression',
            label: 'Expression',
            chips: ['Natural smile', 'Genuine smile', 'Soft natural smile with slight asymmetry', 'Mid-sentence, slightly open mouth', 'Relaxed, authentic micro-expression', 'Composed and serious, holding steady eye contact with the lens', 'Excited', 'Skeptical', 'Surprised', 'Thinking', 'Laughing', 'Serious/focused', 'Mid-sentence'],
          },
          {
            key: 'action',
            label: 'Action',
            chips: [
              'Speaking to camera', 'Holding product', 'Applying product', 'Unboxing', 'Pointing', 'Typing on phone', 'Drinking', 'Showing before/after', 'Looking at camera',
              // Staged versions of the quick picks — what the hands are doing,
              // not just the verb. These are what the built-in presets use.
              'Speaking straight to camera mid-sentence, gesturing with one hand',
              'Holding the product up beside the face, label turned to camera',
              'Applying the product to one cheek, eyes flicking back to the lens',
              'Unboxing the product on the counter with both hands in frame',
            ],
            placeholder: 'e.g. "Holding product up next to face, showing label"',
            wide: true,
          },
        ],
      },
      {
        // Camera lives in the Scene & Pose tab right after Pose & Action —
        // framing the shot is the same mental step as setting the pose, so it
        // no longer sits off on a disconnected tab of its own.
        id: 'camera',
        label: 'Camera',
        icon: Camera,
        fields: [
          {
            key: 'shotType',
            label: 'Shot Type',
            chips: ['Close-up face', 'Medium shot (waist up)', 'Third-Person Shot', 'Full body', 'Over-the-shoulder', 'Eye level', 'Low angle', 'High angle', 'Dutch angle'],
          },
          {
            key: 'cameraAngle',
            label: 'Camera Angle',
            chips: ['Eye Level', 'Low angle', 'High angle', 'Bird\'s eye', 'Worm\'s eye', 'Dutch tilt', 'Over-the-shoulder'],
          },
          {
            key: 'cameraDevice',
            label: 'Camera Device',
            chips: [PHOTOREALISM_STYLE],
            wide: true,
          },
        ],
      },
      {
        id: 'setting',
        label: 'Setting',
        icon: MapPin,
        fields: [
          {
            key: 'location',
            label: 'Location',
            chips: ['Bedroom', 'Living room', 'Kitchen', 'Bathroom', 'Car interior', 'Gym', 'Coffee shop', 'Office', 'Outdoors park', 'Beach', 'Studio backdrop', 'Monastery courtyard'],
          },
          {
            key: 'background',
            label: 'Background Details',
            chips: [
              'Neutral wall', 'Bookshelf', 'Plants', 'Bed with pillows', 'Kitchen counter', 'Car Interior', 'Blurred background', 'Window with natural light', 'Minimalist',
              // Dressed sets rather than one noun — a named prop and a depth cue,
              // which is what stops the model inventing a studio backdrop.
              'Minimalist bedroom with a linen bed and a single plant, softly blurred',
              'Bright bedroom corner with a window and sheer curtains, softly blurred',
              'Aesthetic bedroom with pastel LED lighting, softly blurred',
              'Warm, lived-in kitchen with subtle clutter, softly blurred',
              'Minimalist kitchen counter with pale cabinets, softly blurred',
              'Cozy living room with a bookshelf and warm lamps, softly blurred',
              'Modern high-rise office with a city skyline through the window, softly blurred',
              'Weathered stone monastery walls and prayer flags, softly blurred',
            ],
            placeholder: 'e.g. "Clean white wall, small monstera plant"',
          },
          {
            key: 'lighting',
            label: 'Lighting',
            chips: [
              'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
              'Soft natural light',
              'Warm golden-hour sunlight raking across the face, glowing skin with soft long shadows',
              'Ring light, bright and even with clear catchlights in the eyes',
              'Harsh on-camera flash, bright highlights and hard shadows that reveal skin texture',
              'Dim, moody bedroom light with a warm lamp glow and soft shadows',
              'Cool fluorescent office lighting, flat and even with a faint green cast',
            ],
            wide: true,
          },
          {
            key: 'weather',
            label: 'Weather',
            chips: ['Sunny', 'Overcast', 'Rainy', 'Cloudy', 'Golden hour', 'Blue hour', 'Indoor (N/A)'],
          },
          {
            key: 'timeOfDay',
            label: 'Time of Day',
            chips: ['Morning', 'Midday', 'Afternoon', 'Golden hour', 'Evening', 'Night'],
          },
        ],
      },
    ],
  },
]

// aspectRatio is part of the profile but doesn't render as a tab field — it lives
// in the dropdown next to the Generate button. Stored as a raw ratio.
export const ASPECT_RATIO_KEY = 'aspectRatio'
export const DEFAULT_ASPECT_RATIO = '9:16'

// Flatten a tab's groups into a single list of fields.
export function getTabFields(tab: TabConfig): FieldConfig[] {
  return tab.groups.flatMap((g) => g.fields)
}

// All field keys across all tabs
export const ALL_FIELD_KEYS = TABS.flatMap((tab) => getTabFields(tab).map((f) => f.key))

// Every built-in preset fills all 28 fields and picks the starred (detailed)
// option wherever the field has one — skin, hair, lighting, expression, makeup,
// action, background. A one-word pick like "Glass skin" or "Long wavy" leaves
// the image model to invent the rest, and what it invents is the plastic, too-
// perfect look these presets exist to avoid. An empty field is worse again: it
// drops out of the prompt entirely.

// Marie — 40s French-Moroccan wellness creator. Athletic, bedroom, morning light.
export const PRESET_MARIE: CharacterProfile = {
  gender: 'Female',
  age: '40-50',
  ethnicity: 'French mixed with Moroccan',
  bodyType: 'Athletic',
  skinTone: 'Tan',
  skinTexture: 'Natural realism — realistic skin with visible pores, light freckles scattered across the nose and cheeks, subtle shine on the T-zone, realistic subsurface scattering and slight natural asymmetry',
  eyeColor: 'Blue',
  eyeShape: 'Downturned',
  hairColor: 'Brunette',
  hairStyle: 'Long wavy with loose flyaways and baby hairs framing the face',
  hairTexture: 'Wavy',
  facialFeatures: 'High cheekbones, soft laugh lines, light freckles across the nose',
  facialHair: 'None',
  distinguishingMarks: 'Small scar through the left eyebrow',
  makeup: 'Skin-like natural makeup with visible skin texture',
  clothingStyle: 'Athleisure Set',
  accessories: 'Gold hoops and a fine chain necklace',
  location: 'Bedroom',
  background: 'Minimalist bedroom with a linen bed and a single plant, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Soft natural smile with slight asymmetry',
  shotType: 'Third-Person Shot',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Zane — 30s American fitness creator. Muscular, bright kitchen, morning.
export const PRESET_ZANE: CharacterProfile = {
  gender: 'Male',
  age: '30-40',
  ethnicity: 'African American',
  bodyType: 'Muscular',
  skinTone: 'Caramel',
  skinTexture: 'Gritty realism — heavily textured skin with pronounced pores, freckles and a few small blemishes, faint acne scarring, mild redness around the nose, visible under-eye texture, fine lines and a small beauty mark',
  eyeColor: 'Dark brown',
  eyeShape: 'Deep-set',
  hairColor: 'Black',
  hairStyle: 'Thick box braids pulled back, with baby hairs along the hairline',
  hairTexture: 'Coily',
  facialFeatures: 'Sharp jawline, strong brow, warm smile lines',
  facialHair: 'Short beard',
  distinguishingMarks: 'Dimples',
  makeup: 'No makeup',
  clothingStyle: 'Casual athleisure',
  accessories: 'Steel watch and a thin chain necklace',
  location: 'Kitchen',
  background: 'Minimalist kitchen counter with pale cabinets, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Sunny',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Relaxed, authentic micro-expression',
  shotType: 'Third-Person Shot',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Yuki — Gen-Z beauty creator. Young, porcelain skin, ring-light look.
export const PRESET_YUKI: CharacterProfile = {
  gender: 'Female',
  age: '20s',
  ethnicity: 'Japanese',
  bodyType: 'Slim',
  skinTone: 'Porcelain',
  skinTexture: 'Subtle realism — smooth, healthy skin with fine visible pores, faint peach fuzz and an even tone, a soft natural matte finish with no plastic smoothing',
  eyeColor: 'Dark brown',
  eyeShape: 'Monolid',
  hairColor: 'Black',
  hairStyle: 'Long straight with blunt bangs and soft flyaways',
  hairTexture: 'Straight',
  facialFeatures: 'Soft features, full lips, rounded cheeks',
  facialHair: 'None',
  distinguishingMarks: 'Small beauty mark under the right eye',
  makeup: 'E-girl makeup with graphic liner, soft blush and glossy lips',
  clothingStyle: 'Streetwear',
  accessories: 'Silver ear cuffs and layered studs',
  location: 'Bedroom',
  background: 'Aesthetic bedroom with pastel LED lighting, softly blurred',
  lighting: 'Ring light, bright and even with clear catchlights in the eyes',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Evening',
  pose: 'Front-on facing camera',
  action: 'Applying the product to one cheek, eyes flicking back to the lens',
  expression: 'Soft natural smile with slight asymmetry',
  shotType: 'Close-up face',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Amara — everyday American UGC creator. Relatable, casual, natural light.
export const PRESET_AMARA: CharacterProfile = {
  gender: 'Female',
  age: '25-30',
  ethnicity: 'American',
  bodyType: 'Average',
  skinTone: 'Beige',
  skinTexture: 'Natural realism — realistic skin with visible pores, light freckles scattered across the nose and cheeks, subtle shine on the T-zone, realistic subsurface scattering and slight natural asymmetry',
  eyeColor: 'Hazel',
  eyeShape: 'Almond',
  hairColor: 'Brunette',
  hairStyle: 'Effortless waves with subtle frizz and natural flyaways',
  hairTexture: 'Wavy',
  facialFeatures: 'Soft features, light freckles across the nose and cheeks',
  facialHair: 'None',
  distinguishingMarks: 'Small beauty mark on the left cheek',
  makeup: 'Skin-like natural makeup with visible skin texture',
  clothingStyle: 'Casual athleisure',
  accessories: 'Gold hoops and a fine chain necklace',
  location: 'Bedroom',
  background: 'Bright bedroom corner with a window and sheer curtains, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Soft natural smile with slight asymmetry',
  shotType: 'Close-up face',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Dev — everyday American UGC creator. Casual, approachable, natural light.
export const PRESET_DEV: CharacterProfile = {
  gender: 'Male',
  age: '25-30',
  ethnicity: 'American',
  bodyType: 'Athletic',
  skinTone: 'Light',
  skinTexture: 'Natural realism — realistic skin with visible pores, light freckles scattered across the nose and cheeks, subtle shine on the T-zone, realistic subsurface scattering and slight natural asymmetry',
  eyeColor: 'Blue',
  eyeShape: 'Almond',
  hairColor: 'Brunette',
  hairStyle: 'Short textured crop with natural movement and a few stray strands',
  hairTexture: 'Wavy',
  facialFeatures: 'Sharp jawline, faint smile lines, light stubble shadow',
  facialHair: 'Stubble',
  distinguishingMarks: 'Small scar above the right eyebrow',
  makeup: 'No makeup',
  clothingStyle: 'Casual athleisure',
  accessories: 'Steel watch and a simple leather bracelet',
  location: 'Living room',
  background: 'Cozy living room with a bookshelf and warm lamps, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Standing',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Relaxed, authentic micro-expression',
  shotType: 'Medium shot (waist up)',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Sofia — Latina mom creator. Curvy, warm kitchen, holding product.
export const PRESET_SOFIA: CharacterProfile = {
  gender: 'Female',
  age: '30-40',
  ethnicity: 'Mexican',
  bodyType: 'Curvy',
  skinTone: 'Caramel',
  skinTexture: 'Natural realism — realistic skin with visible pores, light freckles scattered across the nose and cheeks, subtle shine on the T-zone, realistic subsurface scattering and slight natural asymmetry',
  eyeColor: 'Dark brown',
  eyeShape: 'Almond',
  hairColor: 'Brunette',
  hairStyle: 'Effortless waves with subtle frizz and natural flyaways',
  hairTexture: 'Wavy',
  facialFeatures: 'Soft features, warm smile lines, high cheekbones',
  facialHair: 'None',
  distinguishingMarks: 'Dimples',
  makeup: 'Skin-like natural makeup with visible skin texture',
  clothingStyle: 'Cozy homewear',
  accessories: 'Thin gold necklace and small hoop earrings',
  location: 'Kitchen',
  background: 'Warm, lived-in kitchen with subtle clutter, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Standing',
  action: 'Holding the product up beside the face, label turned to camera',
  expression: 'Soft natural smile with slight asymmetry',
  shotType: 'Medium shot (waist up)',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Hiroshi — distinguished older Asian businessman. Tailored suit, office.
export const PRESET_HIROSHI: CharacterProfile = {
  gender: 'Male',
  age: '60-70',
  ethnicity: 'Japanese',
  bodyType: 'Average',
  skinTone: 'Light',
  skinTexture: 'Mature realism — softly lined skin with visible pores, gentle crow\'s feet and smile lines, faint age spots, natural under-eye texture and warm subsurface scattering',
  eyeColor: 'Dark brown',
  eyeShape: 'Monolid',
  hairColor: 'Gray',
  hairStyle: 'Neatly combed short side part, silver-gray at the temples',
  hairTexture: 'Straight',
  facialFeatures: 'Refined jawline, deep smile lines, thin silver-rimmed reading glasses',
  facialHair: 'Clean-shaven',
  distinguishingMarks: 'Faint age spots across the temples',
  makeup: 'No makeup',
  clothingStyle: 'Tailored charcoal business suit with a crisp white shirt',
  accessories: 'Steel dress watch and a slim wedding band',
  location: 'Office',
  background: 'Modern high-rise office with a city skyline through the window, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Afternoon',
  pose: 'Standing',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Composed and serious, holding steady eye contact with the lens',
  shotType: 'Medium shot (waist up)',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Tenzin — serene Buddhist monk. Weathered skin, robes, monastery.
export const PRESET_TENZIN: CharacterProfile = {
  gender: 'Male',
  age: '50-60',
  ethnicity: 'Tibetan',
  bodyType: 'Average',
  skinTone: 'Tan',
  skinTexture: 'Weathered realism — sun-aged skin with deep laugh lines, coarse visible pores, uneven pigmentation, age spots and a calm, lived-in texture',
  eyeColor: 'Dark brown',
  eyeShape: 'Monolid',
  hairColor: 'Black',
  hairStyle: 'Closely shaved head with fine natural stubble and visible scalp texture',
  hairTexture: 'Fine',
  facialFeatures: 'Kind eyes, deep laugh lines, calm weathered brow',
  facialHair: 'Clean-shaven',
  distinguishingMarks: 'Sun-darkened creases across the forehead',
  makeup: 'No makeup',
  clothingStyle: 'Traditional maroon and saffron Buddhist monk robes',
  accessories: 'Wooden mala prayer beads wrapped around the right wrist',
  location: 'Monastery courtyard',
  background: 'Weathered stone monastery walls and prayer flags, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Overcast',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Relaxed, authentic micro-expression',
  shotType: 'Medium shot (waist up)',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

// Eleanor — warm silver-haired senior. Cozy living room, soft lamp light.
export const PRESET_ELEANOR: CharacterProfile = {
  gender: 'Female',
  age: '70-80',
  ethnicity: 'British',
  bodyType: 'Average',
  skinTone: 'Fair',
  skinTexture: 'Mature realism — softly lined skin with visible pores, gentle crow\'s feet and smile lines, faint age spots, natural under-eye texture and warm subsurface scattering',
  eyeColor: 'Blue',
  eyeShape: 'Hooded',
  hairColor: 'Gray',
  hairStyle: 'Soft silver bob with natural flyaways and a gentle wave',
  hairTexture: 'Fine',
  facialFeatures: 'Warm laugh lines, kind eyes, gold-rimmed reading glasses',
  facialHair: 'None',
  distinguishingMarks: 'Faint age spots across the cheeks',
  makeup: 'Minimal everyday makeup — tinted balm, groomed brows, no foundation',
  clothingStyle: 'Soft knit cardigan over a cotton blouse',
  accessories: 'Pearl necklace and a slim gold wedding band',
  location: 'Living room',
  background: 'Cozy living room with a bookshelf and warm lamps, softly blurred',
  lighting: 'Dim, moody bedroom light with a warm lamp glow and soft shadows',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Afternoon',
  pose: 'Sitting',
  action: 'Speaking straight to camera mid-sentence, gesturing with one hand',
  expression: 'Soft natural smile with slight asymmetry',
  shotType: 'Medium shot (waist up)',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

export function createEmptyProfile(): CharacterProfile {
  const profile: CharacterProfile = { [ASPECT_RATIO_KEY]: DEFAULT_ASPECT_RATIO }
  for (const key of ALL_FIELD_KEYS) {
    profile[key] = ''
  }
  // Camera Device is the one field we always pre-fill — it's a fixed style
  // string that locks every generated character to the same UGC aesthetic.
  profile.cameraDevice = PHOTOREALISM_STYLE
  return profile
}

// Visual DNA — nested shape returned by the vision model when extracting from a photo.
// Sections map 1:1 to the form's tab field keys; flattenDna merges them into a flat profile.

export interface ModelDNA {
  gender: string
  age: string
  ethnicity: string
  bodyType: string
  skinTone: string
  skinTexture: string
  eyeColor: string
  eyeShape: string
  hairColor: string
  hairStyle: string
  hairTexture: string
  facialFeatures: string
  facialHair: string
  distinguishingMarks: string
}

export interface StyleDNA {
  clothingStyle: string
  accessories: string
  makeup: string
}

export interface PoseDNA {
  pose: string
  action: string
  expression: string
}

export interface LocationDNA {
  location: string
  background: string
  lighting: string
  weather: string
  timeOfDay: string
}

export interface CameraDNA {
  shotType: string
  cameraAngle: string
  cameraDevice: string
}

export interface VisualDNA {
  model: ModelDNA
  style: StyleDNA
  pose: PoseDNA
  location: LocationDNA
  camera: CameraDNA
}

export function flattenDna(dna: VisualDNA): Partial<CharacterProfile> {
  const flat: Record<string, string> = {}
  for (const fields of Object.values(dna)) {
    for (const [key, value] of Object.entries(fields as Record<string, string>)) {
      flat[key] = value
    }
  }
  return flat
}

// Build a full form profile from a flat field map — extracted DNA, or an
// inter-app payload. Camera Device is never taken from the source: it stays the
// fixed photorealism string every generated character is locked to.
export function profileFromFlat(flat: Record<string, unknown>): CharacterProfile {
  const profile = createEmptyProfile()
  for (const [key, value] of Object.entries(flat)) {
    if (key === 'cameraDevice') continue
    if (key in profile && typeof value === 'string') profile[key] = value
  }
  profile.cameraDevice = PHOTOREALISM_STYLE
  return profile
}

// One analysed reference photo in the Characters reference library.
//
// Deliberately localStorage-only, and deliberately thumbnail-only. The payload
// that matters is `profile` — the extracted DNA; the picture is just how you
// recognise the row. Keeping the full-size original would mean an IndexedDB
// asset that no bank row points at, which the orphan sweep deletes on the next
// sign-in, so the row carries a ~224px JPEG data URI instead.
export interface CharacterRefItem {
  id: string
  // File name stem, as dropped.
  name: string
  // Small JPEG data URI (may be '' if the browser couldn't decode the file).
  thumb: string
  createdAt: number
  // Set once the analysis lands.
  profile?: CharacterProfile
  error?: string
}

// A row with neither a profile nor an error, and no live analysis running, was
// interrupted mid-analysis (a refresh, a closed tab). It can't be left reading
// "Analysing…" forever, so it reads as a failure the member can retry or clear.
export const INTERRUPTED_REF_ERROR = 'Analysis was interrupted.'

// One-line descriptor for a reference row — enough to tell two analysed faces
// apart in the list without opening either.
export function describeRefProfile(profile: CharacterProfile): string {
  return [profile.gender, profile.age, profile.ethnicity, profile.hairColor && `${profile.hairColor} hair`]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' · ')
}
