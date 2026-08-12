export interface ParentDueDateModel {
  label: string
  dueDate: string | null
}

export function dueDateParentWarning(
  dueDate: string | null,
  parent: ParentDueDateModel | null
): string | null {
  if (!dueDate || !parent?.dueDate || dueDate <= parent.dueDate) return null
  return `Due date ${dueDate} is after the parent ${parent.label} due date ${parent.dueDate}.`
}
