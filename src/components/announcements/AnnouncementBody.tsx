import { Fragment, type ReactNode } from 'react'
import { isSafeHttpUrl } from './media'

// The announcement body, rendered from plain text.
//
// Deliberately a hand-rolled subset rather than a markdown library or
// dangerouslySetInnerHTML: the input is written in one textarea by one person
// and read by every member, so the smallest thing that can't ever inject markup
// wins. Blank lines separate paragraphs, "- " starts a bullet, **bold** is
// bold, [text](url) and bare https:// links become links. Everything else is
// text, including a stray < or &.

interface Block {
  kind: 'para' | 'bullets'
  lines: string[]
}

function toBlocks(body: string): Block[] {
  const blocks: Block[] = []
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)
    if (bullet) {
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'bullets') last.lines.push(bullet[1])
      else blocks.push({ kind: 'bullets', lines: [bullet[1]] })
      continue
    }
    if (line.trim() === '') {
      // A blank line ends whatever block was open; consecutive blanks collapse.
      if (blocks.length && blocks[blocks.length - 1].lines.length) blocks.push({ kind: 'para', lines: [] })
      continue
    }
    const last = blocks[blocks.length - 1]
    // A soft line break inside a paragraph stays inside it, so a pasted
    // paragraph doesn't turn into one <p> per wrapped line.
    if (last?.kind === 'para') last.lines.push(line)
    else blocks.push({ kind: 'para', lines: [line] })
  }
  return blocks.filter((b) => b.lines.length > 0)
}

// [text](url) | bare url | **bold** — matched in one pass so the first opener
// wins and nothing nests.
const INLINE_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]])|\*\*([^*\n]+)\*\*/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index))
    const [, linkText, linkUrl, bareUrl, bold] = match
    const key = `${keyPrefix}-${match.index}`
    if (linkUrl && isSafeHttpUrl(linkUrl)) {
      out.push(<InlineLink key={key} href={linkUrl}>{linkText}</InlineLink>)
    } else if (bareUrl && isSafeHttpUrl(bareUrl)) {
      out.push(<InlineLink key={key} href={bareUrl}>{bareUrl.replace(/^https?:\/\//, '')}</InlineLink>)
    } else if (bold) {
      out.push(<strong key={key} className="font-semibold text-ink-100">{bold}</strong>)
    } else {
      out.push(match[0])
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-dashboard-400 underline decoration-dashboard-400/40 underline-offset-2 transition-colors hover:decoration-dashboard-400"
    >
      {children}
    </a>
  )
}

export default function AnnouncementBody({ body, className = '' }: { body: string; className?: string }) {
  const blocks = toBlocks(body)
  if (blocks.length === 0) return null
  return (
    <div className={`space-y-2.5 text-[13px] leading-relaxed text-ink-300 ${className}`}>
      {blocks.map((block, i) =>
        block.kind === 'bullets' ? (
          <ul key={i} className="space-y-1.5">
            {block.lines.map((line, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-600" aria-hidden />
                <span>{renderInline(line, `${i}-${j}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && ' '}
                {renderInline(line, `${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  )
}
