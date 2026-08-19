import { createServer, type Server as HttpServer } from 'node:http'
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import type {
  McpSettingsSnapshot,
  McpUiContextSnapshot,
  RichTextDocumentSnapshot,
  UpdateMcpSettingsInput
} from '../shared/contracts'
import type { AppDatabase } from '../main/database'
import { createOnMoveMcpServer } from './server'

const LOOPBACK_HOST = '127.0.0.1'
const EMPTY_UI_CONTEXT: McpUiContextSnapshot = { focusId: null, subjectId: null }

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The MCP server could not start.'
}

function validContextId(value: number | null): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? value : null
}

/** Transport-only loopback HTTP host. It never opens its own database connection. */
export class OnMoveMcpHttpServer {
  private httpServer: HttpServer | null = null
  private handler: McpHttpHandler | null = null
  private activePort: number | null = null

  constructor(
    private readonly database: AppDatabase,
    private readonly onMutation: () => void,
    private readonly getUiContext: () => McpUiContextSnapshot = () => EMPTY_UI_CONTEXT,
    private readonly onRichTextMutation: (document: RichTextDocumentSnapshot) => void = () => {}
  ) {}

  endpoint(): string | null {
    return this.activePort === null ? null : `http://${LOOPBACK_HOST}:${this.activePort}/mcp`
  }

  async start(port: number): Promise<string> {
    if (this.httpServer && this.activePort === port) return this.endpoint() as string
    await this.stop()

    const handler = createMcpHandler(
      () => createOnMoveMcpServer(this.database, {
        onMutation: this.onMutation,
        onRichTextMutation: this.onRichTextMutation,
        getCurrentUiContext: this.getUiContext
      }),
      {
        onerror: (error) => console.error('OnMove MCP protocol error:', error.message)
      }
    )
    const nodeHandler = toNodeHandler(handler, {
      onerror: (error) => console.error('OnMove MCP HTTP error:', error.message)
    })
    const validateHost = localhostHostValidation()
    const validateOrigin = localhostOriginValidation()
    const httpServer = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (pathname !== '/mcp') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }
      if (!validateHost(request, response) || !validateOrigin(request, response)) return
      void nodeHandler(request, response)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        httpServer.once('error', onError)
        httpServer.listen(port, LOOPBACK_HOST, () => {
          httpServer.off('error', onError)
          resolve()
        })
      })
      const address = httpServer.address()
      if (!address || typeof address === 'string') throw new Error('MCP server address is unavailable')
      httpServer.on('error', (error) => {
        console.error('OnMove MCP listener error:', error.message)
      })
      this.handler = handler
      this.httpServer = httpServer
      this.activePort = address.port
      return this.endpoint() as string
    } catch (error) {
      httpServer.closeAllConnections()
      if (httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      }
      await handler.close().catch(() => undefined)
      throw error
    }
  }

  async stop(): Promise<void> {
    const httpServer = this.httpServer
    const handler = this.handler
    this.httpServer = null
    this.handler = null
    this.activePort = null

    if (httpServer) {
      httpServer.closeAllConnections()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
    await handler?.close().catch(() => undefined)
  }
}

/** Owns the persisted setting and reconciles it with the server running inside Electron. */
export class OnMoveMcpRuntime {
  private status: McpSettingsSnapshot['status'] = 'stopped'
  private lastError: string | null = null
  private operation = Promise.resolve()
  private readonly http: OnMoveMcpHttpServer
  private uiContext: McpUiContextSnapshot = EMPTY_UI_CONTEXT

  constructor(
    private readonly database: AppDatabase,
    onMutation: () => void,
    onRichTextMutation: (document: RichTextDocumentSnapshot) => void = () => {}
  ) {
    this.http = new OnMoveMcpHttpServer(
      database,
      onMutation,
      () => this.uiContext,
      onRichTextMutation
    )
  }

  setUiContext(context: McpUiContextSnapshot): void {
    this.uiContext = {
      focusId: validContextId(context.focusId),
      subjectId: validContextId(context.subjectId)
    }
  }

  snapshot(): McpSettingsSnapshot {
    return {
      ...this.database.mcpSettings.get(),
      status: this.status,
      endpoint: this.status === 'running' ? this.http.endpoint() : null,
      error: this.lastError
    }
  }

  initialize(): Promise<McpSettingsSnapshot> {
    return this.enqueue(() => this.reconcile())
  }

  update(input: UpdateMcpSettingsInput): Promise<McpSettingsSnapshot> {
    return this.enqueue(async () => {
      this.database.mcpSettings.update(input)
      return this.reconcile()
    })
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      await this.http.stop()
      this.status = 'stopped'
      this.lastError = null
      return this.snapshot()
    }).then(() => undefined)
  }

  private enqueue(
    operation: () => Promise<McpSettingsSnapshot>
  ): Promise<McpSettingsSnapshot> {
    const next = this.operation.then(operation, operation)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }

  private async reconcile(): Promise<McpSettingsSnapshot> {
    const settings = this.database.mcpSettings.get()
    if (!settings.serverEnabled) {
      await this.http.stop()
      this.status = 'stopped'
      this.lastError = null
      return this.snapshot()
    }

    this.status = 'starting'
    this.lastError = null
    try {
      await this.http.start(settings.serverPort)
      this.status = 'running'
    } catch (error) {
      this.status = 'error'
      this.lastError = errorMessage(error)
    }
    return this.snapshot()
  }
}
