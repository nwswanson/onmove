import type { ReactNode } from 'react'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { cn } from '@/lib/utils'

export interface WorkspaceResizeConfig {
  label: string
  value: number
  min: number
  max: number
  direction: 1 | -1
  onChange: (value: number) => void
}

export interface ApplicationShellProps {
  toolbar: ReactNode
  primarySidebar: ReactNode
  primarySidebarResize: WorkspaceResizeConfig
  children: ReactNode
  className?: string
}

/** The domain-free application frame: toolbar, primary navigation, and active workspace. */
export function ApplicationShell({
  toolbar,
  primarySidebar,
  primarySidebarResize,
  children,
  className
}: ApplicationShellProps): React.JSX.Element {
  return (
    <div
      data-slot="application-shell"
      className={cn(
        'flex h-screen flex-col overflow-hidden bg-background text-foreground',
        className
      )}
    >
      {toolbar}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {primarySidebar}
        <ResizeHandle {...primarySidebarResize} />
        {children}
      </div>
    </div>
  )
}

export interface WorkspaceShellProps {
  contextualSidebar?: ReactNode
  contextualSidebarResize?: WorkspaceResizeConfig
  main: ReactNode
  drawer?: ReactNode
  className?: string
}

/**
 * Domain-free active workspace frame. Every screen supplies independent
 * contextual-navigation, main-content, and drawer slots.
 */
export function WorkspaceShell({
  contextualSidebar,
  contextualSidebarResize,
  main,
  drawer,
  className
}: WorkspaceShellProps): React.JSX.Element {
  return (
    <div
      data-slot="workspace-shell"
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}
    >
      {contextualSidebar}
      {contextualSidebar && contextualSidebarResize && (
        <ResizeHandle {...contextualSidebarResize} />
      )}
      {main}
      {drawer}
    </div>
  )
}
