import type * as React from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'section'>): React.JSX.Element {
  return (
    <section
      data-slot="card"
      className={cn('rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="card-content" className={cn('p-6', className)} {...props} />
}

export { Card, CardContent }
