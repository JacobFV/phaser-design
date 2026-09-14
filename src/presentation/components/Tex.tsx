import katex from 'katex'
import { Fragment, useMemo, type ReactNode } from 'react'

/** Inline LaTeX rendered with KaTeX. Rendering errors fall back to the raw source so a typo never blanks a label. */
export function Tex({ children, display = false }: { children: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(children, { throwOnError: false, displayMode: display, output: 'html', strict: 'ignore' })
    } catch {
      return null
    }
  }, [children, display])
  if (html === null) return <span className="tex tex-error">{children}</span>
  return <span className={display ? 'tex tex-display' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Text with inline math between `$…$` delimiters, e.g. "waist growing $\\le 1\\,\\%$ per round trip".
 * Non-string children pass through untouched, so callers can hand it any label.
 */
export function Rich({ children }: { children: ReactNode }) {
  if (typeof children !== 'string' || !children.includes('$')) return <>{children}</>
  const parts = children.split(/(\$[^$]+\$)/g)
  return (
    <>
      {parts.map((p, i) => (p.startsWith('$') && p.endsWith('$') && p.length > 2 ? <Tex key={i}>{p.slice(1, -1)}</Tex> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}
