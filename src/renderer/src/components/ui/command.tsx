import * as React from 'react'
import { Search } from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>): React.JSX.Element {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground',
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  children,
  overlayClassName,
  contentClassName,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Dialog>): React.JSX.Element {
  return (
    <CommandPrimitive.Dialog
      overlayClassName={cn(
        'fixed inset-0 z-50 bg-foreground/18 backdrop-blur-[2px]',
        overlayClassName
      )}
      contentClassName={cn(
        'fixed top-[17%] left-1/2 z-50 w-[min(42rem,calc(100%-3rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none',
        contentClassName
      )}
      className="flex max-h-[min(34rem,70vh)] w-full flex-col overflow-hidden bg-card text-card-foreground"
      {...props}
    >
      {children}
    </CommandPrimitive.Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-border/75 px-4" cmdk-input-wrapper="">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <CommandPrimitive.Input
        className={cn(
          'h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>): React.JSX.Element {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[min(28rem,60vh)] overflow-x-hidden overflow-y-auto p-2', className)}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>): React.JSX.Element {
  return (
    <CommandPrimitive.Empty
      className={cn('py-10 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CommandLoading({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Loading>): React.JSX.Element {
  return (
    <CommandPrimitive.Loading
      className={cn('py-10 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>): React.JSX.Element {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[0.625rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase',
        className
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>): React.JSX.Element {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex min-h-10 cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-primary/20 data-[disabled=true]:opacity-50',
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>): React.JSX.Element {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-1 h-px bg-border/75', className)}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      className={cn('ml-auto text-[0.6875rem] tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut
}
