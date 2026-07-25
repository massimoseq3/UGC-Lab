import { useState, useRef, useCallback } from 'react'
import { Upload, Dna, Check, X } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'

interface PhotoExtractZoneProps {
  isExtracting: boolean
  extractError: string | null
  thumbnail: string | null
  onPhotoDrop: (file: File) => void
  onReset: () => void
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

export default function PhotoExtractZone({
  isExtracting,
  extractError,
  thumbnail,
  onPhotoDrop,
  onReset,
}: PhotoExtractZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validateAndSubmit = useCallback((file: File) => {
    setValidationError(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setValidationError('Unsupported format. Use JPG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_SIZE) {
      setValidationError('File too large. Maximum size is 10 MB.')
      return
    }
    onPhotoDrop(file)
  }, [onPhotoDrop])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) validateAndSubmit(file)
  }, [validateAndSubmit])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) validateAndSubmit(file)
    e.target.value = ''
  }

  // Analyzing state — fixed h-12 so it stays the exact size of the preset pill
  // beside it (the bar + message centre within the row rather than growing it).
  if (isExtracting) {
    return (
      <div className="flex h-12 items-center gap-3 rounded-full border border-green-500/20 bg-green-500/[0.04] px-4">
        {thumbnail && (
          <img
            src={thumbnail}
            alt="Analyzing"
            className="h-8 w-8 shrink-0 rounded-full object-cover opacity-70"
          />
        )}
        <div className="min-w-0 flex-1">
          <GenerationProgress
            isActive={true}
            color="bg-green-500"
            showHelper={false}
            messageClassName="text-xs truncate text-ink-300"
            messages={['Preparing image...', 'Sending request...', 'Extracting visual DNA...', 'Finalizing analysis...']}
          />
        </div>
      </div>
    )
  }

  // Success state — collapsed confirmation
  if (thumbnail && !extractError) {
    return (
      <div className="flex h-12 items-center gap-3 rounded-full border border-green-500/20 bg-green-500/[0.06] px-4">
        <img
          src={thumbnail}
          alt="Source"
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-green-400 light:text-green-600" />
          <span className="truncate text-xs font-medium text-green-300 light:text-green-700">
            Auto-filled from reference image
          </span>
        </div>
        <button
          onClick={onReset}
          title="Clear image"
          aria-label="Clear image"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Empty / drop zone state
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex h-12 cursor-pointer items-center gap-3 rounded-full border border-dashed px-4 transition-all ${dragOver
            ? 'border-green-400/40 bg-green-400/5'
            : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.05]'
          }`}
      >
        <div className={`shrink-0 rounded-full p-1.5 ${dragOver ? 'bg-green-400/10' : 'bg-ink/5'}`}>
          {dragOver ? (
            <Dna className="h-4 w-4 text-green-400 light:text-green-600" strokeWidth={1.5} />
          ) : (
            <Upload className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink-100">
            {dragOver ? 'Drop to extract DNA' : 'Drop an image to autofill'}
          </p>
        </div>
      </div>

      {(validationError || extractError) && (
        <p className="mt-1.5 text-[11px] text-red-400 light:text-red-600">
          {validationError ?? extractError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
