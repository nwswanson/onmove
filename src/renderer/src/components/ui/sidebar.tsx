import * as React from 'react'
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
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col overflow-auto p-3', className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-4', className)} {...props} />
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="sidebar-group" className={cn('flex flex-col gap-1.5', className)} {...props} />
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'px-2 pb-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase',
        className
      )}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>): React.JSX.Element {
  return <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-1', className)} {...props} />
}

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      data-slot="sidebar-menu-item"
      className={cn('relative', className)}
      {...props}
    />
  )
)
SidebarMenuItem.displayName = 'SidebarMenuItem'

function SidebarMenuButton({
  className,
  isActive = false,
  ...props
}: React.ComponentProps<'button'> & { isActive?: boolean }): React.JSX.Element {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'group/menu-button relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium outline-none transition-colors',
        'text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/55 disabled:pointer-events-none disabled:opacity-40',
        'data-[active=true]:bg-primary/30 data-[active=true]:text-sidebar-primary-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/45',
        'data-[active=true]:before:absolute data-[active=true]:before:top-2 data-[active=true]:before:bottom-2 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>): React.JSX.Element {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn('mt-1 ml-3 flex flex-col gap-1 border-l border-sidebar-border pl-2', className)}
      {...props}
    />
  )
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>): React.JSX.Element {
  return <li data-slot="sidebar-menu-sub-item" className={cn('relative', className)} {...props} />
}

function SidebarMenuSubButton({
  className,
  isActive = false,
  ...props
}: React.ComponentProps<'button'> & { isActive?: boolean }): React.JSX.Element {
  return (
    <button
      data-slot="sidebar-menu-sub-button"
      data-active={isActive}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium outline-none transition-colors',
        'text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/55',
        'disabled:pointer-events-none disabled:opacity-40',
        'data-[active=true]:bg-primary/30 data-[active=true]:text-sidebar-primary-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/40',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
}
