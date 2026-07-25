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
              // with the realism cue so it stays a single click.
              'Long wavy with loose flyaways and baby hairs framing the face',
              'Messy bun with soft flyaways and stray strands at the hairline',
              'Sleek ponytail with natural baby hairs at the hairline',
              'Effortless waves with subtle frizz and natural flyaways',
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
            chips: ['No makeup', 'Natural/minimal', 'Skin-like natural makeup with visible skin texture', 'Dewy "no-makeup" makeup', 'Light glam', 'Full glam', 'Dewy skin', 'Bold lip', 'E-girl makeup', 'Soft glam'],
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
            chips: ['Natural smile', 'Genuine smile', 'Soft natural smile with slight asymmetry', 'Mid-sentence, slightly open mouth', 'Relaxed, authentic micro-expression', 'Excited', 'Skeptical', 'Surprised', 'Thinking', 'Laughing', 'Serious/focused', 'Mid-sentence'],
          },
          {
            key: 'action',
            label: 'Action',
            chips: ['Speaking to camera', 'Holding product', 'Applying product', 'Unboxing', 'Pointing', 'Typing on phone', 'Drinking', 'Showing before/after', 'Looking at camera'],
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
            chips: ['Bedroom', 'Living room', 'Kitchen', 'Bathroom', 'Car interior', 'Gym', 'Coffee shop', 'Office', 'Outdoors park', 'Beach', 'Studio backdrop'],
          },
          {
            key: 'background',
            label: 'Background Details',
            chips: ['Neutral wall', 'Bookshelf', 'Plants', 'Bed with pillows', 'Kitchen counter', 'Car Interior', 'Blurred background', 'Window with natural light', 'Minimalist'],
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

export const PRESET_MARIE: CharacterProfile = {
  gender: 'Female',
  age: '40',
  ethnicity: 'French mixed with Moroccan',
  bodyType: 'Athletic',
  skinTone: 'Tan',
  skinTexture: 'Glass skin',
  eyeColor: 'Blue',
  eyeShape: 'Downturned',
  hairColor: 'Brunette',
  hairStyle: 'Long wavy',
  hairTexture: 'Straight',
  facialFeatures: 'High cheekbones',
  facialHair: 'None',
  distinguishingMarks: 'Scar',
  makeup: 'Dewy skin',
  clothingStyle: 'Athleisure Set',
  accessories: 'Gold hoops',
  location: 'Bedroom',
  background: 'Minimalist',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: '',
  pose: 'Front-on facing camera',
  action: 'Speaking to camera',
  expression: 'Genuine smile',
  shotType: 'Third-Person Shot',
  cameraAngle: 'Eye Level',
  cameraDevice: PHOTOREALISM_STYLE,
  aspectRatio: '9:16',
}

export const PRESET_ZANE: CharacterProfile = {
  gender: 'Male',
  age: '30-40',
  ethnicity: 'American',
  bodyType: 'Muscular',
  skinTone: 'Caramel',
  skinTexture: 'Gritty realism — heavily textured skin with pronounced pores, freckles and a few small blemishes, faint acne scarring, mild redness around the nose, visible under-eye texture, fine lines and a small beauty mark',
  eyeColor: 'Brown',
  eyeShape: 'Monolid',
  hairColor: 'Brunette',
  hairStyle: 'Braids',
  hairTexture: 'Thick',
  facialFeatures: 'Sharp jawline',
  facialHair: 'Short beard',
  distinguishingMarks: 'Dimples',
  makeup: 'No makeup',
  clothingStyle: 'Athleisure set',
  accessories: 'Smartwatch',
  location: 'Minimalist Kitchen',
  background: 'Minimalist',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Sunny',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Looking at camera',
  expression: 'Genuine smile',
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
  facialFeatures: 'Soft features, full lips',
  facialHair: 'None',
  distinguishingMarks: 'None',
  makeup: 'E-girl makeup',
  clothingStyle: 'Streetwear',
  accessories: 'Earrings',
  location: 'Bedroom',
  background: 'Aesthetic bedroom with pastel LED lighting, softly blurred',
  lighting: 'Ring light, bright and even with clear catchlights in the eyes',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Evening',
  pose: 'Front-on facing camera',
  action: 'Applying product',
  expression: 'Natural smile',
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
  facialFeatures: 'Soft features, light freckles',
  facialHair: 'None',
  distinguishingMarks: 'None',
  makeup: 'Natural/minimal',
  clothingStyle: 'Casual athleisure',
  accessories: 'Gold hoops',
  location: 'Bedroom',
  background: 'Window with natural light',
  lighting: 'Soft natural light',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking to camera',
  expression: 'Genuine smile',
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
  hairStyle: 'Short textured',
  hairTexture: 'Wavy',
  facialFeatures: 'Sharp jawline',
  facialHair: 'Stubble',
  distinguishingMarks: 'None',
  makeup: 'No makeup',
  clothingStyle: 'Casual athleisure',
  accessories: 'Watch',
  location: 'Living room',
  background: 'Neutral wall',
  lighting: 'Soft natural light',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Standing',
  action: 'Speaking to camera',
  expression: 'Genuine smile',
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
  facialFeatures: 'Soft features, warm smile',
  facialHair: 'None',
  distinguishingMarks: 'Dimples',
  makeup: 'Natural/minimal',
  clothingStyle: 'Cozy homewear',
  accessories: 'Necklace',
  location: 'Kitchen',
  background: 'Warm, lived-in kitchen with subtle clutter, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Morning',
  pose: 'Standing',
  action: 'Holding product',
  expression: 'Genuine smile',
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
  skinTexture: 'Mature, distinguished skin with visible pores, deep smile lines, age spots and natural under-eye texture',
  eyeColor: 'Dark brown',
  eyeShape: 'Monolid',
  hairColor: 'Gray',
  hairStyle: 'Neatly combed short side part, silver-gray',
  hairTexture: 'Straight',
  facialFeatures: 'Distinguished features, refined jawline, reading glasses',
  facialHair: 'Clean-shaven',
  distinguishingMarks: 'None',
  makeup: 'No makeup',
  clothingStyle: 'Tailored charcoal business suit with a crisp white shirt',
  accessories: 'Watch',
  location: 'Office',
  background: 'Modern high-rise office with a city skyline through the window, softly blurred',
  lighting: 'Soft natural light',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Afternoon',
  pose: 'Standing',
  action: 'Speaking to camera',
  expression: 'Serious/focused',
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
  skinTexture: 'Weathered, sun-aged skin with deep laugh lines, visible pores, age spots and a calm, lived-in texture',
  eyeColor: 'Dark brown',
  eyeShape: 'Monolid',
  hairColor: 'Black',
  hairStyle: 'Shaved head',
  hairTexture: '',
  facialFeatures: 'Calm serene expression lines, kind eyes',
  facialHair: 'Clean-shaven',
  distinguishingMarks: 'None',
  makeup: 'No makeup',
  clothingStyle: 'Traditional maroon and saffron Buddhist monk robes',
  accessories: 'Wooden mala prayer beads',
  location: 'Monastery courtyard',
  background: 'Weathered stone walls and prayer flags, softly blurred',
  lighting: 'Soft, diffused natural window light, creating gentle highlights on the cheekbones and realistic subsurface scattering on the skin',
  weather: 'Overcast',
  timeOfDay: 'Morning',
  pose: 'Front-on facing camera',
  action: 'Speaking to camera',
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
  skinTexture: 'Mature, delicate skin with soft wrinkles, visible pores, age spots, fine crepey texture and gentle subsurface scattering',
  eyeColor: 'Blue',
  eyeShape: 'Hooded',
  hairColor: 'Gray',
  hairStyle: 'Soft silver bob with natural flyaways',
  hairTexture: 'Fine',
  facialFeatures: 'Warm laugh lines, kind eyes, reading glasses',
  facialHair: 'None',
  distinguishingMarks: 'None',
  makeup: 'Natural/minimal',
  clothingStyle: 'Cozy homewear',
  accessories: 'Necklace',
  location: 'Living room',
  background: 'Cozy living room with a bookshelf and warm lamps, softly blurred',
  lighting: 'Dim, moody bedroom light with a warm lamp glow and soft shadows',
  weather: 'Indoor (N/A)',
  timeOfDay: 'Afternoon',
  pose: 'Sitting',
  action: 'Speaking to camera',
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
