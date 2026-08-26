export function SemanticModelInfo(): React.JSX.Element {
  return (
    <section
      aria-label="Semantic model availability"
      className="mt-3 rounded-lg border border-border/75 bg-background/55 p-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h3 className="text-xs font-semibold">Semantic model</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Universal Sentence Encoder Lite v1
          </p>
        </div>
        <span className="text-[0.6875rem] font-medium text-success">
          Included with OnMove
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[0.6875rem] sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Availability</dt>
          <dd className="mt-0.5 font-medium">Available offline</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Included size</dt>
          <dd className="mt-0.5 font-medium tabular-nums">27.1 MiB</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Model updates</dt>
          <dd className="mt-0.5 font-medium">Updated with the app</dd>
        </div>
      </dl>

      <p className="mt-3 text-[0.6875rem] leading-4 text-muted-foreground">
        The model assets ship inside OnMove and never download at runtime.
        The model initializes locally once per app session; derived embeddings persist separately
        and are reused between sessions.
      </p>
      <p className="mt-2 text-[0.6875rem] leading-4 text-muted-foreground">
        The bundled model is immutable, so there is no model-cache eviction control. Clearing
        OnMove user data is not offered here.
      </p>
    </section>
  )
}
