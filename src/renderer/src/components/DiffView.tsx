import { memo, useMemo } from 'react'
import { diffLines, collapseContext } from '../diff'

/**
 * Unified line diff of two texts. `numbered` shows line numbers, which only mean something when the
 * texts are whole files; an Edit call carries just the replaced snippet.
 */
function DiffView({ oldText, newText, numbered = false }: { oldText: string; newText: string; numbered?: boolean }) {
  const rows = useMemo(() => collapseContext(diffLines(oldText, newText)), [oldText, newText])
  if (rows.length === 0) return <div className="text-[12px] text-fg-faint px-2.5 py-2">(nema razlike)</div>
  return (
    <div className="font-mono text-[12px] leading-[1.5] rounded-lg overflow-auto border border-border bg-bg max-h-96">
      <table className="border-collapse min-w-full">
        <tbody>
          {rows.map((r, i) => {
            if (r.type === 'gap') {
              return (
                <tr key={i} className="text-fg-faint bg-bg-elev">
                  <td colSpan={numbered ? 3 : 2} className="px-2.5 py-0.5 select-none">⋯ {r.hidden} nepromijenjenih redaka</td>
                </tr>
              )
            }
            const tone = r.type === 'add' ? 'bg-ok/10' : r.type === 'del' ? 'bg-danger/10' : ''
            return (
              <tr key={i} className={tone}>
                {numbered && <td className="px-2 text-right text-fg-faint select-none w-px whitespace-nowrap">{r.type === 'add' ? r.newNo : r.oldNo}</td>}
                <td className={`px-1.5 select-none w-px ${r.type === 'add' ? 'text-ok' : r.type === 'del' ? 'text-danger' : 'text-fg-faint'}`}>
                  {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
                </td>
                <td className="pr-3 whitespace-pre">{r.text || ' '}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default memo(DiffView)
