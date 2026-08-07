import { useState, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Layers3, Plus, X } from 'lucide-react'
import type { FocusSnapshot } from '../../../../shared/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Health = 'on-track' | 'at-risk' | 'off-track' | 'unknown'
type CommitmentStatus = 'active' | 'paused' | 'done' | 'cancelled'
type CommitmentType = 'action' | 'ongoing'
type UpdateState = 'red' | 'yellow' | 'green' | 'none'

interface PrototypeCommitment {
  id: string
  statement: string
  type: CommitmentType
  dueDate: string
  status: CommitmentStatus
}

interface PrototypeUpdate {
  id: string
  observation: string
  date: string
  state: UpdateState
}

interface PrototypeRecord {
  description: string
  goal: string
  commitments: PrototypeCommitment[]
  updates: PrototypeUpdate[]
}

interface PrototypeThread {
  id: string
  title: string
  health: Health
  dueDate: string | null
  nextReview: string
}

const CHILD_SIDEBAR_MIN = 220
const CHILD_SIDEBAR_MAX = 320

const HEALTH_LABELS: Record<Health, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  'off-track': 'Off track',
  unknown: 'Unknown'
}

const PROTOTYPE_THREADS: PrototypeThread[] = [
  {
    id: 'sprint-execution',
    title: 'Sprint execution',
    health: 'at-risk',
    dueDate: null,
    nextReview: 'Aug 14'
  },
  {
    id: 'team-health',
    title: 'Team health',
    health: 'on-track',
    dueDate: null,
    nextReview: 'Aug 21'
  },
  {
    id: 'project-clarity',
    title: 'Project clarity',
    health: 'unknown',
    dueDate: 'Aug 31',
    nextReview: 'Aug 17'
  }
]

const PROTOTYPE_RECORDS: Record<string, PrototypeRecord> = {
  overall: {
    description: 'Coordinate a predictable launch without trading away team health.',
    goal: 'Deliver Project Atlas with the intended customer value and a sustainable operating rhythm.',
    commitments: [
      {
        id: 'overall-risk-review',
        statement: 'Hold a cross-team risk review every Friday',
        type: 'ongoing',
        dueDate: '',
        status: 'active'
      },
      {
        id: 'overall-sponsor-decision',
        statement: 'Confirm the release boundary with sponsors',
        type: 'action',
        dueDate: '2026-08-17',
        status: 'active'
      }
    ],
    updates: [
      {
        id: 'overall-release-update',
        observation: 'Sponsors accepted the release sequence; reliability scope remains open.',
        date: '2026-08-07',
        state: 'yellow'
      },
      {
        id: 'overall-team-update',
        observation: 'The team reports sustainable workload for the current release slice.',
        date: '2026-08-06',
        state: 'green'
      }
    ]
  },
  'sprint-execution': {
    description: 'Keep sprint planning clear, timely, and predictable.',
    goal: 'Each sprint begins with understood work and finishes without preventable carryover.',
    commitments: [
      {
        id: 'ticket-quality',
        statement: 'Improve ticket quality before sprint planning',
        type: 'ongoing',
        dueDate: '',
        status: 'active'
      },
      {
        id: 'scope-review',
        statement: 'Surface scope changes before the planning cutoff',
        type: 'action',
        dueDate: '2026-08-13',
        status: 'active'
      }
    ],
    updates: [
      {
        id: 'ticket-review',
        observation: 'Four of twelve tickets still needed acceptance criteria clarified in planning.',
        date: '2026-08-07',
        state: 'yellow'
      },
      {
        id: 'sprint-close',
        observation: 'The sprint closed with two items carried over and no unresolved blockers.',
        date: '2026-08-05',
        state: 'green'
      }
    ]
  },
  'team-health': {
    description: 'Protect sustainable delivery and a candid working environment.',
    goal: 'The team can sustain delivery without hidden overload or eroding trust.',
    commitments: [
      {
        id: 'ownership-map',
        statement: 'Publish a clear ownership map for the next release slice',
        type: 'action',
        dueDate: '2026-08-12',
        status: 'active'
      }
    ],
    updates: [
      {
        id: 'team-retro',
        observation: 'The team described workload as sustainable and asked for one owner per release risk.',
        date: '2026-08-06',
        state: 'green'
      }
    ]
  },
  'project-clarity': {
    description: 'Keep boundaries, tradeoffs, and decisions easy to find.',
    goal: 'The team and sponsors share the same definition of success and release boundaries.',
    commitments: [
      {
        id: 'sponsor-review',
        statement: 'Review the project decision record with sponsors',
        type: 'action',
        dueDate: '2026-08-17',
        status: 'active'
      }
    ],
    updates: [
      {
        id: 'decision-record',
        observation: 'The draft captures scope boundaries and the open reliability tradeoff.',
        date: '2026-08-04',
        state: 'none'
      }
    ]
  }
}

function HealthMark({ health }: { health: Health }): React.JSX.Element {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        health === 'on-track' && 'bg-success',
        (health === 'at-risk' || health === 'off-track') && 'bg-destructive',
        health === 'unknown' && 'bg-muted-foreground/55'
      )}
      aria-hidden="true"
    />
  )
}

function HealthBadge({ health }: { health: Health }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 px-2 py-0.5 text-[0.6875rem]',
        health === 'on-track' && 'border-success/35 bg-success/12',
        (health === 'at-risk' || health === 'off-track') &&
          'border-destructive/35 bg-destructive/10',
        health === 'unknown' && 'bg-muted/55 text-muted-foreground'
      )}
    >
      <HealthMark health={health} />
      {HEALTH_LABELS[health]}
    </Badge>
  )
}

const inlineControlClass =
  'h-8 rounded-md border-0 bg-transparent px-2 text-xs shadow-none hover:bg-background/75 focus-visible:bg-background focus-visible:ring-1'

interface FocusWorkspaceProps {
  focus: FocusSnapshot
  toolbar: ReactNode
}

export function FocusWorkspace({ focus, toolbar }: FocusWorkspaceProps): React.JSX.Element {
  const [selectedSourceId, setSelectedSourceId] = useState('overall')
  const [childSidebarWidth, setChildSidebarWidth] = useState(252)
  const [records, setRecords] = useState<Record<string, PrototypeRecord>>(() => ({
    ...PROTOTYPE_RECORDS,
    overall: {
      ...PROTOTYPE_RECORDS.overall,
      description: focus.description ?? PROTOTYPE_RECORDS.overall.description
    }
  }))
  const [nextLocalId, setNextLocalId] = useState(1)

  const selectedThread = PROTOTYPE_THREADS.find((thread) => thread.id === selectedSourceId)
  const selectedRecord = records[selectedSourceId] ?? records.overall
  const selectedTitle = selectedThread?.title ?? focus.title
  const selectedHealth = selectedThread?.health ?? 'at-risk'
  const selectedStatus = selectedThread ? 'Active' : focus.status === 'paused' ? 'Paused' : 'Active'

  function updateRecord(change: (record: PrototypeRecord) => PrototypeRecord): void {
    setRecords((current) => ({
      ...current,
      [selectedSourceId]: change(current[selectedSourceId] ?? current.overall)
    }))
  }

  function addCommitment(): void {
    const id = `local-commitment-${nextLocalId}`
    setNextLocalId((current) => current + 1)
    updateRecord((record) => ({
      ...record,
      commitments: [
        ...record.commitments,
        { id, statement: '', type: 'action', dueDate: '', status: 'active' }
      ]
    }))
  }

  function updateCommitment(id: string, change: Partial<PrototypeCommitment>): void {
    updateRecord((record) => ({
      ...record,
      commitments: record.commitments.map((commitment) =>
        commitment.id === id ? { ...commitment, ...change } : commitment
      )
    }))
  }

  function deleteCommitment(id: string): void {
    updateRecord((record) => ({
      ...record,
      commitments: record.commitments.filter((commitment) => commitment.id !== id)
    }))
  }

  function addUpdate(): void {
    const id = `local-update-${nextLocalId}`
    setNextLocalId((current) => current + 1)
    updateRecord((record) => ({
      ...record,
      updates: [
        { id, observation: '', date: '2026-08-07', state: 'none' },
        ...record.updates
      ]
    }))
  }

  function updateUpdate(id: string, change: Partial<PrototypeUpdate>): void {
    updateRecord((record) => ({
      ...record,
      updates: record.updates.map((update) =>
        update.id === id ? { ...update, ...change } : update
      )
    }))
  }

  function deleteUpdate(id: string): void {
    updateRecord((record) => ({
      ...record,
      updates: record.updates.filter((update) => update.id !== id)
    }))
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside
        className="flex h-full shrink-0 flex-col border-r border-border/80 bg-muted/28"
        aria-label="Focus sidebar"
        style={{ width: childSidebarWidth }}
      >
        <div className="drag-region flex h-13 shrink-0 items-center border-b border-border/75 px-3.5">
          <p className="text-xs font-semibold tracking-tight">Threads</p>
        </div>

        <div role="tablist" aria-label="Focus sections" className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-1 pt-1 text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Focus
          </p>
          <button
            id="focus-source-overall"
            type="button"
            role="tab"
            aria-selected={selectedSourceId === 'overall'}
            aria-controls="focus-source-panel"
            className={cn(
              'mb-4 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs font-medium outline-none transition-colors',
              'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55',
              selectedSourceId === 'overall' && 'bg-primary/30 ring-1 ring-primary/40'
            )}
            onClick={() => setSelectedSourceId('overall')}
          >
            <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Overall</span>
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
          </button>

          <p className="px-2 pb-1 text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Threads
          </p>
          {PROTOTYPE_THREADS.map((thread) => {
            const selected = thread.id === selectedSourceId
            return (
              <button
                key={thread.id}
                id={`focus-source-${thread.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="focus-source-panel"
                aria-label={`${thread.title}, ${HEALTH_LABELS[thread.health]}`}
                className={cn(
                  'mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left outline-none transition-colors',
                  'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55',
                  selected && 'bg-primary/30 ring-1 ring-primary/40'
                )}
                onClick={() => setSelectedSourceId(thread.id)}
              >
                <HealthMark health={thread.health} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{thread.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                    <CalendarDays className="size-3" aria-hidden="true" />
                    {thread.dueDate ? `Due ${thread.dueDate}` : `Review ${thread.nextReview}`}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-muted-foreground/60',
                    selected && 'text-foreground'
                  )}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
      </aside>

      <ResizeHandle
        label="Resize Focus sidebar"
        value={childSidebarWidth}
        min={CHILD_SIDEBAR_MIN}
        max={CHILD_SIDEBAR_MAX}
        direction={1}
        onChange={setChildSidebarWidth}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" aria-labelledby="focus-heading">
        {toolbar}
        <header className="shrink-0 border-b border-border/75 bg-card/45 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="focus-heading" className="mr-1 text-xl font-semibold tracking-[-0.025em]">
              {selectedTitle}
            </h1>
            <Badge variant="outline" className="px-2 py-0.5 text-[0.6875rem]">
              {selectedStatus}
            </Badge>
            <HealthBadge health={selectedHealth} />
          </div>
          <label htmlFor="focus-description" className="sr-only">
            Description
          </label>
          <Textarea
            key={`${selectedSourceId}-description`}
            id="focus-description"
            aria-label={`${selectedTitle} description`}
            className="mt-2 min-h-12 resize-none border-0 bg-transparent px-0 py-1 text-xs leading-5 shadow-none focus-visible:bg-background/70 focus-visible:px-2 focus-visible:ring-1"
            value={selectedRecord.description}
            onChange={(event) =>
              updateRecord((record) => ({ ...record, description: event.target.value }))
            }
          />
        </header>

        <div
          id="focus-source-panel"
          role="tabpanel"
          aria-labelledby={`focus-source-${selectedSourceId}`}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="space-y-5 p-5">
            <div>
              <label htmlFor="focus-goal" className="mb-1.5 block text-xs font-semibold">
                Goal
              </label>
              <Textarea
                key={`${selectedSourceId}-goal`}
                id="focus-goal"
                className="min-h-16 resize-none text-xs leading-5"
                value={selectedRecord.goal}
                onChange={(event) =>
                  updateRecord((record) => ({ ...record, goal: event.target.value }))
                }
              />
            </div>

            <section aria-labelledby="commitments-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="commitments-heading" className="text-xs font-semibold">
                  Commitments
                </h2>
                <Button type="button" variant="outline" size="sm" onClick={addCommitment}>
                  <Plus aria-hidden="true" />
                  New commitment
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/80 bg-card/45">
                <table className="w-full min-w-[30rem] table-fixed text-left text-xs">
                  <thead className="border-b border-border/75 bg-muted/50 text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="w-auto px-3 py-2">Commitment</th>
                      <th scope="col" className="w-20 px-2 py-2">Type</th>
                      <th scope="col" className="w-32 px-2 py-2">Due</th>
                      <th scope="col" className="w-20 px-2 py-2">Status</th>
                      <th scope="col" className="w-9"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecord.commitments.map((commitment) => (
                      <tr key={commitment.id} className="border-b border-border/65 last:border-b-0">
                        <td className="p-1.5">
                          <Input
                            aria-label={`Commitment: ${commitment.statement || 'Untitled'}`}
                            placeholder="Describe the commitment…"
                            className={inlineControlClass}
                            value={commitment.statement}
                            onChange={(event) =>
                              updateCommitment(commitment.id, { statement: event.target.value })
                            }
                          />
                        </td>
                        <td className="p-1.5">
                          <select
                            aria-label={`Type for ${commitment.statement || 'new commitment'}`}
                            className={cn(inlineControlClass, 'w-full outline-none')}
                            value={commitment.type}
                            onChange={(event) =>
                              updateCommitment(commitment.id, {
                                type: event.target.value as CommitmentType
                              })
                            }
                          >
                            <option value="action">Action</option>
                            <option value="ongoing">Ongoing</option>
                          </select>
                        </td>
                        <td className="p-1.5">
                          <Input
                            type="date"
                            aria-label={`Due date for ${commitment.statement || 'new commitment'}`}
                            className={inlineControlClass}
                            value={commitment.dueDate}
                            onChange={(event) =>
                              updateCommitment(commitment.id, { dueDate: event.target.value })
                            }
                          />
                        </td>
                        <td className="p-1.5">
                          <select
                            aria-label={`Status for ${commitment.statement || 'new commitment'}`}
                            className={cn(inlineControlClass, 'w-full outline-none')}
                            value={commitment.status}
                            onChange={(event) =>
                              updateCommitment(commitment.id, {
                                status: event.target.value as CommitmentStatus
                              })
                            }
                          >
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="done">Done</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td className="p-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete commitment ${commitment.statement || 'Untitled'}`}
                            onClick={() => deleteCommitment(commitment.id)}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {selectedRecord.commitments.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-5 text-center text-xs text-muted-foreground">No commitments</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="updates-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="updates-heading" className="text-xs font-semibold">
                  Updates
                </h2>
                <Button type="button" variant="outline" size="sm" onClick={addUpdate}>
                  <Plus aria-hidden="true" />
                  New update
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/80 bg-card/45">
                <table className="w-full min-w-[28rem] table-fixed text-left text-xs">
                  <thead className="border-b border-border/75 bg-muted/50 text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="w-auto px-3 py-2">Update</th>
                      <th scope="col" className="w-32 px-2 py-2">Date</th>
                      <th scope="col" className="w-20 px-2 py-2">State</th>
                      <th scope="col" className="w-9"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecord.updates.map((update) => (
                      <tr key={update.id} className="border-b border-border/65 last:border-b-0">
                        <td className="p-1.5">
                          <Input
                            aria-label={`Update: ${update.observation || 'Untitled'}`}
                            placeholder="Write an update…"
                            className={inlineControlClass}
                            value={update.observation}
                            onChange={(event) =>
                              updateUpdate(update.id, { observation: event.target.value })
                            }
                          />
                        </td>
                        <td className="p-1.5">
                          <Input
                            type="date"
                            aria-label={`Date for ${update.observation || 'new update'}`}
                            className={inlineControlClass}
                            value={update.date}
                            onChange={(event) =>
                              updateUpdate(update.id, { date: event.target.value })
                            }
                          />
                        </td>
                        <td className="p-1.5">
                          <select
                            aria-label={`State for ${update.observation || 'new update'}`}
                            className={cn(
                              inlineControlClass,
                              'w-full outline-none',
                              update.state === 'green' && 'text-success',
                              (update.state === 'yellow' || update.state === 'red') &&
                                'text-destructive'
                            )}
                            value={update.state}
                            onChange={(event) =>
                              updateUpdate(update.id, { state: event.target.value as UpdateState })
                            }
                          >
                            <option value="none">None</option>
                            <option value="green">Green</option>
                            <option value="yellow">Yellow</option>
                            <option value="red">Red</option>
                          </select>
                        </td>
                        <td className="p-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete update ${update.observation || 'Untitled'}`}
                            onClick={() => deleteUpdate(update.id)}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {selectedRecord.updates.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-5 text-center text-xs text-muted-foreground">No updates</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
