import { ExternalLink } from 'lucide-react'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { TagUseRowModel } from '@/features/tags/tag-presenters'

interface TagUseTableProps {
  tagName: string
  rows: readonly TagUseRowModel[]
  onOpenContext: (rowId: string) => void
}

/** Receiver for already-projected tag rows; owns table markup and link behavior. */
export function TagUseTable({
  tagName,
  rows,
  onOpenContext
}: TagUseTableProps): React.JSX.Element {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border/80 bg-card/45 shadow-xs">
      <Table aria-label={`Uses of @${tagName}`} className="min-w-[42rem] table-fixed">
        <TableHeader className="bg-muted/45">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[30%]">Location</TableHead>
            <TableHead className="w-32">Field</TableHead>
            <TableHead>Snippet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="align-top">
                <a
                  href={`#tag-use-${row.id}`}
                  className="inline-flex max-w-full items-start gap-1.5 font-medium text-primary underline decoration-primary/45 underline-offset-3 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenContext(row.id)
                  }}
                >
                  <span className="line-clamp-2"><TaggedText value={row.location} /></span>
                  <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                </a>
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                {row.source}
              </TableCell>
              <TableCell className="align-top text-sm leading-5 text-foreground/85">
                <span className="line-clamp-3 break-words">
                  <TaggedText value={row.snippet} />
                </span>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="h-28 text-center text-sm text-muted-foreground">
                No visible uses of @{tagName}.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
