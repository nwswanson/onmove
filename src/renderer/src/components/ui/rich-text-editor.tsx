import {
  $isListItemNode,
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode
} from '@lexical/list'
import {
  $createLinkNode,
  $isLinkNode,
  $toggleLink,
  LinkNode
} from '@lexical/link'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalTextEntity } from '@lexical/react/useLexicalTextEntity'
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText
} from '@lexical/selection'
import {
  $createParagraphNode,
  $createTextNode,
  $applyNodeReplacement,
  $getRoot,
  $getSelection,
  $isRootNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  $setSelection,
  UNDO_COMMAND,
  TextNode,
  type EditorConfig,
  type EditorState,
  type RangeSelection,
  type TextFormatType
} from 'lexical'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import {
  Bold,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Strikethrough,
  SquareArrowOutUpRight,
  Underline,
  Undo2
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { firstTextTag } from '../../../../shared/text-tags'
import {
  RICH_TEXT_PREFIX,
  richTextPlainText,
  serializedRichTextEditorState
} from '../../../../shared/rich-text-value'

const HIGHLIGHT_FORMAT: TextFormatType = 'highlight'

const TEXT_COLOR_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'Gray', value: 'var(--rich-text-gray)' },
  { label: 'Red', value: 'var(--rich-text-red)' },
  { label: 'Orange', value: 'var(--rich-text-orange)' },
  { label: 'Yellow', value: 'var(--rich-text-yellow)' },
  { label: 'Green', value: 'var(--rich-text-green)' },
  { label: 'Blue', value: 'var(--rich-text-blue)' },
  { label: 'Purple', value: 'var(--rich-text-purple)' }
] as const

const TEXT_COLOR_VALUES = new Set<string>(TEXT_COLOR_OPTIONS.map(({ value }) => value))

const theme: InitialConfigType['theme'] = {
  list: {
    checklist: 'onmove-checklist',
    listitem: 'ml-5 pl-0.5',
    listitemChecked: 'onmove-checklist-item onmove-checklist-item-checked',
    listitemUnchecked: 'onmove-checklist-item onmove-checklist-item-unchecked',
    // Lexical represents a nested list with a structural wrapper <li>. That
    // wrapper must not draw a second marker beside the real child list item.
    nested: { listitem: 'onmove-nested-list-item ml-4 list-none' },
    ol: 'list-decimal space-y-1',
    ul: 'list-disc space-y-1'
  },
  link: 'cursor-pointer text-primary underline decoration-primary/70 underline-offset-2',
  paragraph: 'mb-1 last:mb-0',
  text: {
    bold: 'font-semibold',
    highlight: 'onmove-rich-text-highlight',
    italic: 'italic',
    strikethrough: 'line-through',
    underline: 'underline',
    underlineStrikethrough: 'underline line-through'
  }
}

const LINK_ATTRIBUTES = {
  target: '_blank',
  rel: 'noopener noreferrer'
} as const

/** A durable visual token; linking and backreferences intentionally come later. */
class TagNode extends TextNode {
  $config() {
    return this.config('tag', { extends: TextNode })
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.classList.add('onmove-text-tag')
    element.dataset.textTag = 'true'
    return element
  }

  canInsertTextBefore(): boolean {
    return false
  }

  isTextEntity(): true {
    return true
  }
}

function $createTagNode(text: string, source?: TextNode): TagNode {
  const node = $applyNodeReplacement(new TagNode(text))
  if (source) {
    node.setFormat(source.getFormat())
    node.setStyle(source.getStyle())
    node.setDetail(source.getDetail())
  }
  return node
}

function textTagMatch(text: string): { start: number; end: number } | null {
  const match = firstTextTag(text)
  return match ? { start: match.start, end: match.end } : null
}

function createTagNode(source: TextNode): TagNode {
  return $createTagNode(source.getTextContent(), source)
}

function TextTagsPlugin(): null {
  useLexicalTextEntity(textTagMatch, TagNode, createTagNode)
  return null
}

function normalizeLinkUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)
    ? `mailto:${trimmed}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function validLinkUrl(value: string): boolean {
  return normalizeLinkUrl(value) !== null
}

function initialEditorState(value: string): InitialConfigType['editorState'] {
  const serialized = serializedRichTextEditorState(value)
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
  return serializedRichTextEditorState(value) !== null
}

export { richTextPlainText }

interface RichTextToolbarProps {
  compact: boolean
  onOpenInWindow?: () => void
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

/** Adds the macOS-native formatting shortcuts that are not supplied by Lexical. */
function FormattingShortcutsPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (!event.metaKey || event.ctrlKey || event.altKey) return false
          const key = event.key.toLowerCase()
          const format =
            key === 'x' && event.shiftKey
              ? 'strikethrough'
              : key === 'y' && !event.shiftKey
                ? HIGHLIGHT_FORMAT
                : null
          if (!format) return false

          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor]
  )

  return null
}

function RichTextToolbar({ compact, onOpenInWindow }: RichTextToolbarProps): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [underline, setUnderline] = useState(false)
  const [strikethrough, setStrikethrough] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [listType, setListType] = useState<'bullet' | 'number' | 'check' | null>(null)
  const [color, setColor] = useState('default')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [activeLinkUrl, setActiveLinkUrl] = useState<string | null>(null)
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const lastRangeSelection = useRef<RangeSelection | null>(null)

  const updateToolbar = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    lastRangeSelection.current = selection.clone()
    setBold(selection.hasFormat('bold'))
    setItalic(selection.hasFormat('italic'))
    setUnderline(selection.hasFormat('underline'))
    setStrikethrough(selection.hasFormat('strikethrough'))
    setHighlight(selection.hasFormat(HIGHLIGHT_FORMAT))
    const selectionColor = $getSelectionStyleValueForProperty(selection, 'color', 'default')
    setColor(
      selectionColor === ''
        ? 'mixed'
        : TEXT_COLOR_VALUES.has(selectionColor)
          ? selectionColor
          : 'custom'
    )
    const anchorNode = selection.anchor.getNode()
    if ($isRootNode(anchorNode)) {
      setListType(null)
      setActiveLinkUrl(null)
      return
    }
    const topLevel = anchorNode.getTopLevelElementOrThrow()
    const nextListType = $isListNode(topLevel) ? topLevel.getListType() : null
    setListType(
      nextListType === 'bullet' || nextListType === 'number' || nextListType === 'check'
        ? nextListType
        : null
    )
    const linkNode = $isLinkNode(anchorNode)
      ? anchorNode
      : $findMatchingParent(anchorNode, $isLinkNode)
    setActiveLinkUrl(linkNode?.getURL() ?? null)
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

  function restoreRangeSelection(): RangeSelection | null {
    const savedSelection = lastRangeSelection.current
    if (savedSelection) {
      const restoredSelection = savedSelection.clone()
      $setSelection(restoredSelection)
      return restoredSelection
    }
    const currentSelection = $getSelection()
    return $isRangeSelection(currentSelection) ? currentSelection : null
  }

  function openLinkEditor(): void {
    setLinkUrl(activeLinkUrl ?? '')
    setLinkError(null)
    setLinkEditorOpen(true)
  }

  function applyLink(): void {
    const normalizedUrl = normalizeLinkUrl(linkUrl)
    if (!normalizedUrl) {
      setLinkError('Enter an http, https, or email link.')
      return
    }

    editor.update(() => {
      const selection = restoreRangeSelection()
      if (!selection) return
      const anchorNode = selection.anchor.getNode()
      const existingLink = $isLinkNode(anchorNode)
        ? anchorNode
        : $findMatchingParent(anchorNode, $isLinkNode)

      if (selection.isCollapsed() && !existingLink) {
        const link = $createLinkNode(normalizedUrl, LINK_ATTRIBUTES)
        link.append($createTextNode(normalizedUrl))
        selection.insertNodes([link])
        link.selectEnd()
      } else {
        $toggleLink({ url: normalizedUrl, ...LINK_ATTRIBUTES })
      }
    })
    setLinkEditorOpen(false)
    setLinkError(null)
    editor.focus()
  }

  function removeLink(): void {
    editor.update(() => {
      if (restoreRangeSelection()) $toggleLink(null)
    })
    setLinkEditorOpen(false)
    setLinkError(null)
    editor.focus()
  }

  function applyTextColor(nextColor: string): void {
    editor.update(() => {
      const selection = restoreRangeSelection()
      if (selection) {
        $patchStyleText(selection, { color: nextColor === 'default' ? null : nextColor })
      }
    })
    editor.focus()
  }

  function toolbarButton(
    label: string,
    pressed: boolean | undefined,
    disabled: boolean,
    action: () => void,
    icon: React.ReactNode,
    tooltip = label,
    keyShortcut?: string
  ): React.JSX.Element {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(compact ? 'size-7' : 'size-8', pressed && 'bg-accent text-accent-foreground')}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={keyShortcut}
        disabled={disabled}
        title={tooltip}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action}
      >
        {icon}
      </Button>
    )
  }

  return (
    <div>
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
        {toolbarButton(
          'Strikethrough',
          strikethrough,
          false,
          () => format('strikethrough'),
          <Strikethrough aria-hidden="true" />,
          'Strikethrough (⌘⇧X)',
          'Meta+Shift+X'
        )}
        {toolbarButton(
          'Highlight',
          highlight,
          false,
          () => format(HIGHLIGHT_FORMAT),
          <Highlighter aria-hidden="true" />,
          'Highlight (⌘Y)',
          'Meta+Y'
        )}
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
        {toolbarButton(
          'Checklist',
          listType === 'check',
          false,
          () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
          <ListChecks aria-hidden="true" />
        )}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        {toolbarButton(
          activeLinkUrl ? 'Edit link' : 'Insert link',
          activeLinkUrl !== null,
          false,
          openLinkEditor,
          <Link2 aria-hidden="true" />
        )}
        <label className="ml-auto flex h-7 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-muted-foreground hover:bg-accent">
          Color
          <select
            aria-label="Text color"
            className="max-w-20 bg-transparent text-foreground outline-none"
            value={color}
            onMouseDown={() => {
              editor.getEditorState().read(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection)) lastRangeSelection.current = selection.clone()
              })
            }}
            onChange={(event) => applyTextColor(event.target.value)}
          >
            {color === 'custom' || color === 'mixed' ? (
              <option value={color} disabled>
                {color === 'mixed' ? 'Mixed' : 'Custom'}
              </option>
            ) : null}
            {TEXT_COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {onOpenInWindow ? toolbarButton(
          'Open in new window',
          undefined,
          false,
          onOpenInWindow,
          <SquareArrowOutUpRight aria-hidden="true" />
        ) : null}
      </div>
      {linkEditorOpen ? (
        <div
          role="group"
          aria-label="Link editor"
          className="flex flex-wrap items-start gap-2 border-b border-border/70 bg-muted/18 p-2"
        >
          <div className="min-w-48 flex-1">
            <Input
              autoFocus
              aria-label="Link URL"
              className="h-8"
              placeholder="https://example.com"
              value={linkUrl}
              onChange={(event) => {
                setLinkUrl(event.target.value)
                setLinkError(null)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                event.stopPropagation()
                applyLink()
              }}
            />
            {linkError ? (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {linkError}
              </p>
            ) : null}
          </div>
          <Button type="button" size="sm" onClick={applyLink}>
            {activeLinkUrl ? 'Update' : 'Insert'}
          </Button>
          {activeLinkUrl ? (
            <Button type="button" size="sm" variant="outline" onClick={removeLink}>
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setLinkEditorOpen(false)
              setLinkError(null)
              editor.focus()
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
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
  /** Lets the editor document consume a height supplied by its parent. */
  fillHeight?: boolean
  className?: string
  onOpenInWindow?: () => void
  /** Changes only when a value committed outside this editor should be applied. */
  externalRevision?: string | number
}

function ExternalValuePlugin({
  value,
  currentValueRef,
  revision
}: {
  value: string
  currentValueRef: MutableRefObject<string>
  revision?: string | number
}): null {
  const [editor] = useLexicalComposerContext()
  const priorRevisionRef = useRef(revision)

  // A committed value from another window must reach Lexical before the next
  // paint. Applying it from a passive effect visibly left the receiving editor
  // one character behind during continuous typing.
  useLayoutEffect(() => {
    if (priorRevisionRef.current === revision) return
    priorRevisionRef.current = revision
    const externalValue = value
    if (externalValue === currentValueRef.current) return
    currentValueRef.current = externalValue
    const serialized = serializedRichTextEditorState(externalValue)
    if (serialized) {
      editor.setEditorState(editor.parseEditorState(serialized), { tag: 'external-sync' })
      return
    }
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      for (const line of externalValue.split('\n')) {
        root.append($createParagraphNode().append($createTextNode(line)))
      }
    }, { tag: 'external-sync' })
  }, [currentValueRef, editor, revision, value])

  return null
}

export function RichTextEditor({
  id,
  value,
  onChange,
  onBlur,
  ariaLabel,
  placeholder = 'Write something…',
  compact = false,
  fillHeight = false,
  className,
  onOpenInWindow,
  externalRevision
}: RichTextEditorProps): React.JSX.Element {
  const currentValue = useRef(value)
  const config = useMemo<InitialConfigType>(
    () => ({
      namespace: 'OnMoveRichText',
      nodes: [ListNode, ListItemNode, LinkNode, TagNode],
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
        fillHeight && 'flex min-h-0 flex-col',
        className
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.(currentValue.current)
      }}
    >
      <LexicalComposer initialConfig={config}>
        <RichTextToolbar compact={compact} onOpenInWindow={onOpenInWindow} />
        <div
          data-slot="rich-text-editor-document"
          className={cn('relative', fillHeight && 'min-h-0 flex-1')}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                aria-label={ariaLabel}
                aria-multiline="true"
                className={cn(
                  'w-full resize-y overflow-auto px-3 py-2 text-sm leading-6 outline-none select-text',
                  compact ? 'min-h-20' : 'min-h-24',
                  fillHeight && 'h-full resize-none'
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
          <CheckListPlugin />
          <LinkPlugin validateUrl={validLinkUrl} attributes={LINK_ATTRIBUTES} />
          <ClickableLinkPlugin newTab />
          <TextTagsPlugin />
          <FormattingShortcutsPlugin />
          <ListTabIndentationPlugin />
          <ExternalValuePlugin
            value={value}
            currentValueRef={currentValue}
            revision={externalRevision}
          />
          <OnChangePlugin
            ignoreHistoryMergeTagChange={false}
            onChange={(editorState) => {
              const nextValue = serializeRichText(editorState)
              if (nextValue === currentValue.current) return
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
  onOpenInWindow?: () => void
}

export function RichTextContent({
  value,
  ariaLabel,
  className,
  onOpenInWindow
}: RichTextContentProps): React.JSX.Element {
  const config = useMemo<InitialConfigType>(
    () => ({
      namespace: 'OnMoveRichTextReadOnly',
      nodes: [ListNode, ListItemNode, LinkNode, TagNode],
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
    <div className="group/rich-content relative pr-9">
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
        <ClickableLinkPlugin newTab />
        <TextTagsPlugin />
      </LexicalComposer>
      {onOpenInWindow ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 size-8 text-muted-foreground"
          aria-label={`Open ${ariaLabel ?? 'rich text'} in new window`}
          title="Open in new window"
          onClick={onOpenInWindow}
        >
          <SquareArrowOutUpRight aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
