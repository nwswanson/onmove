import type * as React from 'react'
import { cn } from '@/lib/utils'

function Sidebar({ className, ...props }: React.ComponentProps<'aside'>): React.JSX.Element {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        'relative flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-4', className)} {...props} />
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-content" className={cn('min-h-0 flex-1 p-3', className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-4', className)} {...props} />
}

export { Sidebar, SidebarContent, SidebarFooter, SidebarHeader }
