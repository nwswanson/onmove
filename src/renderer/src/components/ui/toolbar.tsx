import type * as React from 'react'
import { cn } from '@/lib/utils'

function Toolbar({ className, ...props }: React.ComponentProps<'header'>): React.JSX.Element {
  return (
    <header
      role="toolbar"
      data-slot="toolbar"
      className={cn(
        'drag-region relative flex h-13 shrink-0 items-center border-b border-border/75 bg-background/88 px-3 backdrop-blur-xl',
        className
      )}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="toolbar-group"
      className={cn('flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Toolbar, ToolbarGroup }
