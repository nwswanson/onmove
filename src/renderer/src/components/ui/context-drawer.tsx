import { X } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ContextDrawerProps extends Omit<React.ComponentProps<'aside'>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}

/**
 * Composable shell for any contextual inspector. The required `onClose` prop
 * guarantees that every drawer instance renders an accessible close button.
 */
function ContextDrawer({
  title,
  description,
  footer,
  onClose,
  children,
  className,
  ...props
}: ContextDrawerProps): React.JSX.Element {
  return (
    <aside
      data-slot="context-drawer"
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-border/75 bg-card/82 text-card-foreground backdrop-blur-xl',
        className
      )}
      {...props}
    >
      <div className="flex min-h-16 items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 size-8 text-muted-foreground"
          aria-label="Close context drawer"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div data-slot="context-drawer-content" className="min-h-0 flex-1 overflow-auto p-4">
        {children}
      </div>
      {footer && (
        <div
          data-slot="context-drawer-footer"
          className="flex items-center justify-end gap-2 border-t border-border/70 p-4"
        >
          {footer}
        </div>
      )}
    </aside>
  )
}

function ContextDrawerSection({
  className,
  ...props
}: React.ComponentProps<'section'>): React.JSX.Element {
  return (
    <section
      data-slot="context-drawer-section"
      className={cn('space-y-4 rounded-xl border border-border/75 bg-background/45 p-4', className)}
      {...props}
    />
  )
}

export { ContextDrawer, ContextDrawerSection }
