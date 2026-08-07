import {
  $isListItemNode,
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode
} from '@lexical/list'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText
} from '@lexical/selection'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type EditorState,
  type TextFormatType
} from 'lexical'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline,
  Undo2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const RICH_TEXT_PREFIX = 'onmove-rich-text:1:'

const theme: InitialConfigType['theme'] = {
  list: {
    listitem: 'ml-5 pl-0.5',
    // Lexical represents a nested list with a structural wrapper <li>. That
    // wrapper must not draw a second marker beside the real child list item.
    nested: { listitem: 'ml-4 list-none' },
    ol: 'list-decimal space-y-1',
    ul: 'list-disc space-y-1'
  },
  paragraph: 'mb-1 last:mb-0',
  text: {
    bold: 'font-semibold',
    italic: 'italic',
    underline: 'underline'
  }
}

function serializedEditorState(value: string): string | null {
  if (!value.startsWith(RICH_TEXT_PREFIX)) return null
  const serialized = value.slice(RICH_TEXT_PREFIX.length)
  try {
    const parsed = JSON.parse(serialized) as { root?: unknown }
    return parsed && typeof parsed === 'object' && parsed.root ? serialized : null
  } catch {
    return null
  }
}

function initialEditorState(value: string): InitialConfigType['editorState'] {
  const serialized = serializedEditorState(value)
  if (serialized) return serialized

  return () => {
    const root = $getRoot()
    root.clear()
    const lines = value.split('\n')
    for (const line of lines) {
      root.append($createParagraphNode().append($createTextNode(line)))
    }
  }
}

/** Serialize only non-empty documents; empty editors retain the existing empty-string contract. */
export function serializeRichText(editorState: EditorState): string {
  const hasText = editorState.read(() => $getRoot().getTextContent().trim().length > 0)
  return hasText ? `${RICH_TEXT_PREFIX}${JSON.stringify(editorState.toJSON())}` : ''
}

export function isRichText(value: string): boolean {
  return serializedEditorState(value) !== null
}

/** Plain-text projection for search, accessibility, and contract-level tests. */
export function richTextPlainText(value: string): string {
  const serialized = serializedEditorState(value)
  if (!serialized) return value

  const document = JSON.parse(serialized) as {
    root: { children?: unknown[] }
  }
  function read(node: unknown): string {
    if (!node || typeof node !== 'object') return ''
    const record = node as { children?: unknown[]; text?: unknown; type?: unknown }
    if (typeof record.text === 'string') return record.text
    const content = (record.children ?? []).map(read).join('')
    return record.type === 'paragraph' || record.type === 'listitem' ? `${content}\n` : content
  }
  return read(document.root).replace(/\n+$/, '')
}

interface RichTextToolbarProps {
  compact: boolean
}

/**
 * Keeps normal Tab focus navigation outside lists while giving list items the
 * familiar Tab/Shift+Tab nesting behavior of a native outline editor.
 */
function ListTabIndentationPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(
    () =>
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false

          const anchorItem = $findMatchingParent(selection.anchor.getNode(), $isListItemNode)
          const focusItem = $findMatchingParent(selection.focus.getNode(), $isListItemNode)
          if (!anchorItem || !focusItem) return false
          if (!anchorItem.getTopLevelElementOrThrow().is(focusItem.getTopLevelElementOrThrow())) {
            return false
          }

          event.preventDefault()
          return editor.dispatchCommand(
            event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
            undefined
          )
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  )

  return null
}

function RichTextToolbar({ compact }: RichTextToolbarProps): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [underline, setUnderline] = useState(false)
  const [listType, setListType] = useState<'bullet' | 'number' | null>(null)
  const [color, setColor] = useState('default')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    setBold(selection.hasFormat('bold'))
    setItalic(selection.hasFormat('italic'))
    setUnderline(selection.hasFormat('underline'))
    setColor($getSelectionStyleValueForProperty(selection, 'color', 'default'))
    const topLevel = selection.anchor.getNode().getTopLevelElementOrThrow()
    const nextListType = $isListNode(topLevel) ? topLevel.getListType() : null
    setListType(nextListType === 'bullet' || nextListType === 'number' ? nextListType : null)
  }, [])

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => editorState.read(updateToolbar)),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            updateToolbar()
            return false
          },
          COMMAND_PRIORITY_LOW
        ),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (available) => {
            setCanUndo(available)
            return false
          },
          COMMAND_PRIORITY_LOW
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (available) => {
            setCanRedo(available)
            return false
          },
          COMMAND_PRIORITY_LOW
        )
      ),
    [editor, updateToolbar]
  )

  function format(format: TextFormatType): void {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
  }

  function toolbarButton(
    label: string,
    pressed: boolean | undefined,
    disabled: boolean,
    action: () => void,
    icon: React.ReactNode
  ): React.JSX.Element {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(compact ? 'size-7' : 'size-8', pressed && 'bg-accent text-accent-foreground')}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action}
      >
        {icon}
      </Button>
    )
  }

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border/70 bg-muted/28 p-1"
    >
      {toolbarButton('Undo', undefined, !canUndo, () => editor.dispatchCommand(UNDO_COMMAND, undefined), <Undo2 aria-hidden="true" />)}
      {toolbarButton('Redo', undefined, !canRedo, () => editor.dispatchCommand(REDO_COMMAND, undefined), <Redo2 aria-hidden="true" />)}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      {toolbarButton('Bold', bold, false, () => format('bold'), <Bold aria-hidden="true" />)}
      {toolbarButton('Italic', italic, false, () => format('italic'), <Italic aria-hidden="true" />)}
      {toolbarButton('Underline', underline, false, () => format('underline'), <Underline aria-hidden="true" />)}
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      {toolbarButton(
        'Bulleted list',
        listType === 'bullet',
        false,
        () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        <List aria-hidden="true" />
      )}
      {toolbarButton(
        'Numbered list',
        listType === 'number',
        false,
        () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
        <ListOrdered aria-hidden="true" />
      )}
      <label className="ml-auto flex h-7 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-muted-foreground hover:bg-accent">
        Color
        <select
          aria-label="Text color"
          className="max-w-20 bg-transparent text-foreground outline-none"
          value={color}
          onChange={(event) => {
            const nextColor = event.target.value
            editor.update(() => {
              const selection = $getSelection()
              if (selection) {
                $patchStyleText(selection, { color: nextColor === 'default' ? null : nextColor })
              }
            })
          }}
        >
          <option value="default">Default</option>
          <option value="#52799f">Cerulean</option>
          <option value="#e2583e">Tigerlily</option>
          <option value="#6c9138">Greenery</option>
        </select>
      </label>
    </div>
  )
}

export interface RichTextEditorProps {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: (value: string) => void
  ariaLabel: string
  placeholder?: string
  compact?: boolean
  className?: string
}

export function RichTextEditor({
  id,
  value,
  onChange,
  onBlur,
  ariaLabel,
  placeholder = 'Write something…',
  compact = false,
  className
}: RichTextEditorProps): React.JSX.Element {
  const currentValue = useRef(value)
  const config = useMemo<InitialConfigType>(
    () => ({
      namespace: 'OnMoveRichText',
      nodes: [ListNode, ListItemNode],
      theme,
      editorState: initialEditorState(value),
      onError(error) {
        throw error
      }
    }),
    [value]
  )

  return (
    <div
      data-slot="rich-text-editor"
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-background/75 shadow-xs outline-none transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35',
        className
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.(currentValue.current)
      }}
    >
      <LexicalComposer initialConfig={config}>
        <RichTextToolbar compact={compact} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                aria-label={ariaLabel}
                aria-multiline="true"
                className={cn(
                  'w-full resize-y overflow-auto px-3 py-2 text-sm leading-6 outline-none select-text',
                  compact ? 'min-h-20' : 'min-h-24'
                )}
              />
            }
            placeholder={
              <div className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <ListTabIndentationPlugin />
          <OnChangePlugin
            ignoreHistoryMergeTagChange={false}
            onChange={(editorState) => {
              const nextValue = serializeRichText(editorState)
              currentValue.current = nextValue
              onChange(nextValue)
            }}
          />
        </div>
      </LexicalComposer>
    </div>
  )
}

export interface RichTextContentProps {
  value: string
  ariaLabel?: string
  className?: string
}

export function RichTextContent({
  value,
  ariaLabel,
  className
}: RichTextContentProps): React.JSX.Element {
  const config = useMemo<InitialConfigType>(
    () => ({
      namespace: 'OnMoveRichTextReadOnly',
      nodes: [ListNode, ListItemNode],
      theme,
      editable: false,
      editorState: initialEditorState(value),
      onError(error) {
        throw error
      }
    }),
    [value]
  )

  return (
    <LexicalComposer key={value} initialConfig={config}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label={ariaLabel}
            aria-readonly="true"
            tabIndex={-1}
            className={cn('text-sm leading-6 outline-none select-text', className)}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ListPlugin />
    </LexicalComposer>
  )
}
