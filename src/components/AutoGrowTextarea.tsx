import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

// A textarea that grows to fit what's in it instead of scrolling inside itself.
//
// A field that scrolls internally is a scroll trap: the wheel over it moves the
// FIELD, not the column the field sits in, so a form of filled-in boxes can't be
// scrolled by dragging through the middle of it — which is exactly what a long
// auto-filled product form is. Growing the field hands the scroll back to the
// column that owns it.
//
// `maxHeight` is the escape hatch for a box with no natural ceiling (a paste
// box that might take a whole product page): past it the field scrolls again,
// deliberately. Leave it off everywhere else.
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & { maxHeight?: number }

export default function AutoGrowTextarea({ maxHeight, value, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Measure from `auto` so the box can shrink back down when text is deleted.
  // Layout effect, not an effect: resizing after paint shows one frame at the
  // wrong height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      el.style.height = 'auto'
      const wanted = el.scrollHeight
      const capped = maxHeight ? Math.min(wanted, maxHeight) : wanted
      el.style.height = `${capped}px`
      el.style.overflowY = maxHeight && wanted > maxHeight ? 'auto' : 'hidden'
    }
    measure()
    // The column resizes with the window, and a narrower box wraps onto more
    // lines — so width changes move the right height too.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, maxHeight])

  return <textarea ref={ref} value={value} {...rest} />
}
