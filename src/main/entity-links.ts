import type { DomainStore } from './data/domain'
import type {
  CommitmentParent,
  NoteParent,
  OnMoveEntityLinkTarget,
  TodoParent,
  UpdateParent
} from '../shared/contracts'
import type { ParsedEntityReference } from '../shared/entity-reference'

type LinkReference = OnMoveEntityLinkTarget['reference']

function target(
  reference: LinkReference,
  focusId: number,
  threadId: number | null = null,
  commitmentId: number | null = null,
  routineId: number | null = null,
  subjectId: number | null = null
): OnMoveEntityLinkTarget {
  return { reference, focusId, threadId, commitmentId, routineId, subjectId }
}

function forThread(
  domain: DomainStore,
  reference: LinkReference,
  threadId: number,
  subjectId: number | null = null
): OnMoveEntityLinkTarget | null {
  const thread = domain.threads.find(threadId)
  return thread ? target(reference, thread.focusId, thread.id, null, null, subjectId) : null
}

function forCommitment(
  domain: DomainStore,
  reference: LinkReference,
  commitmentId: number,
  subjectId: number | null = null
): OnMoveEntityLinkTarget | null {
  const commitment = domain.commitments.find(commitmentId)
  if (!commitment) return null
  if (commitment.parent.type === 'focus') {
    return domain.focuses.find(commitment.parent.id)
      ? target(reference, commitment.parent.id, null, null, null, subjectId)
      : null
  }
  const owner = forThread(domain, reference, commitment.parent.id, subjectId)
  return owner ? { ...owner, commitmentId } : null
}

function forParent(
  domain: DomainStore,
  reference: LinkReference,
  parent: UpdateParent | NoteParent | TodoParent | CommitmentParent,
  subjectId: number | null = null
): OnMoveEntityLinkTarget | null {
  if (parent.type === 'focus') {
    return domain.focuses.find(parent.id)
      ? target(reference, parent.id, null, null, null, subjectId)
      : null
  }
  if (parent.type === 'thread' || parent.type === 'thread-scope') {
    return forThread(domain, reference, parent.id, subjectId)
  }
  return forCommitment(domain, reference, parent.id, subjectId)
}

/** Resolves one durable entity URL to its current owning workspace. */
export function resolveOnMoveEntityLink(
  domain: DomainStore,
  parsed: ParsedEntityReference
): OnMoveEntityLinkTarget | null {
  const reference = { type: parsed.kind, id: parsed.id }
  if (parsed.kind === 'focus') {
    return domain.focuses.find(parsed.id) ? target(reference, parsed.id) : null
  }
  if (parsed.kind === 'thread') {
    return forThread(domain, reference, parsed.id)
  }
  if (parsed.kind === 'commitment') {
    return forCommitment(domain, reference, parsed.id)
  }
  if (parsed.kind === 'routine') {
    const routine = domain.routines.find(parsed.id)
    if (!routine) return null
    const owner = forParent(domain, reference, routine.parent)
    return owner
      ? { ...owner, routineId: owner.threadId === null ? null : routine.id }
      : null
  }
  if (parsed.kind === 'update') {
    const update = domain.updates.find(parsed.id)
    return update
      ? forParent(domain, reference, update.parent, update.scope?.subjectId ?? null)
      : null
  }
  if (parsed.kind === 'todo') {
    const todo = domain.todos.find(parsed.id)
    const subjectId = todo && 'scope' in todo.parent ? todo.parent.scope.subjectId : null
    return todo ? forParent(domain, reference, todo.parent, subjectId) : null
  }
  if (parsed.kind === 'note') {
    const note = domain.notes.find(parsed.id)
    return note ? forParent(domain, reference, note.parent) : null
  }

  const subject = domain.subjects.find(parsed.id)
  if (!subject) return null
  // A Subject may be reused. Prefer the first actionable Thread lens, then a
  // Focus definition. Canonical entity links intentionally contain no hidden
  // UI context, so this selection is deterministic rather than stateful.
  for (const focus of domain.focuses.list()) {
    for (const thread of domain.threads.listForFocus(focus.id)) {
      if (domain.threadScopes.get(thread.id).subjects.some(({ id }) => id === subject.id)) {
        return target(reference, focus.id, thread.id, null, null, subject.id)
      }
    }
  }
  for (const focus of domain.focuses.list()) {
    if (domain.focusScopes.get(focus.id).subjects.some(({ id }) => id === subject.id)) {
      return target(reference, focus.id, null, null, null, subject.id)
    }
  }
  return null
}
