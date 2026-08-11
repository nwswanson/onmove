import * as React from 'react'

export type HexColor = `#${string}`;
export type SunflowerColor = string;

export type SunflowerSeed =
  | SunflowerColor
  | {
      id?: React.Key;
      color: SunflowerColor;
      label?: string;
    };

export interface SunflowerProps
  extends Omit<React.SVGProps<SVGSVGElement>, "width" | "height"> {
  /**
   * SVG width and height in CSS pixels.
   */
  diameter: number;

  /**
   * Array order controls position:
   * - seeds[0] is at the center
   * - later seeds spiral outward
   */
  seeds: readonly SunflowerSeed[];

  /**
   * Empty space between the outermost seeds and the boundary.
   * Defaults to 3.5% of the diameter.
   */
  padding?: number;

  /**
   * Controls seed density and automatically calculated seed size.
   */
  seedScale?: number;

  /**
   * Override the automatically calculated seed radius.
   *
   * When provided, it is also considered when calculating how many
   * seeds can reasonably fit.
   */
  seedRadius?: number;

  /**
   * Smallest useful rendered seed diameter.
   *
   * The default of 3px keeps individual seeds visually distinguishable.
   */
  minSeedDiameter?: number;

  /**
   * Absolute DOM/rendering safety limit.
   *
   * The actual limit is the smaller of:
   * - the diameter-derived display limit
   * - maxSeeds
   */
  maxSeeds?: number;

  /**
   * Optional value-based deduplication key.
   *
   * Without this, overflow deduplication uses normal JavaScript Set
   * behavior: strings by value and objects by reference.
   */
  getSeedKey?: (
    seed: SunflowerSeed,
    originalIndex: number,
  ) => unknown;

  /** Rotation of the spiral in degrees. */
  rotation?: number;

  /** Fill behind the seeds. */
  background?: string;

  /** Outer-circle color. */
  borderColor?: string;

  /** Outer-circle width. */
  borderWidth?: number;

  /** Accessible label for the SVG. */
  ariaLabel?: string;
}

export interface SunflowerLimitOptions {
  padding?: number;
  borderWidth?: number;
  seedScale?: number;
  seedRadius?: number;
  minSeedDiameter?: number;
  maxSeeds?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const DEFAULT_SEED_SCALE = 0.45;
const DEFAULT_MIN_SEED_DIAMETER = 3;
const DEFAULT_MAX_SEEDS = 4_096;

/**
 * Calculates the maximum number of seeds that can be displayed without
 * automatically shrinking them below minSeedDiameter.
 */
export function getSunflowerSeedLimit(
  diameter: number,
  {
    padding,
    borderWidth = 1,
    seedScale = DEFAULT_SEED_SCALE,
    seedRadius,
    minSeedDiameter = DEFAULT_MIN_SEED_DIAMETER,
    maxSeeds = DEFAULT_MAX_SEEDS,
  }: SunflowerLimitOptions = {},
): number {
  const size = Math.max(1, diameter);
  const center = size / 2;

  const safeBorderWidth = Math.max(0, borderWidth);
  const safePadding = Math.max(0, padding ?? size * 0.035);
  const safeSeedScale = Math.max(0, seedScale);
  const safeMaxSeeds = Math.max(0, Math.floor(maxSeeds));

  const boundaryRadius = Math.max(
    0,
    center - safeBorderWidth / 2,
  );

  const usableRadius = Math.max(
    0,
    boundaryRadius - safePadding,
  );

  if (
    usableRadius === 0 ||
    safeSeedScale === 0 ||
    safeMaxSeeds === 0
  ) {
    return 0;
  }

  /*
   * If seedRadius is explicitly supplied, respect that as the minimum
   * radius when determining how many seeds fit.
   */
  const minimumRadius = Math.max(
    Number.EPSILON,
    Math.max(0, minSeedDiameter) / 2,
    Math.max(0, seedRadius ?? 0),
  );

  /*
   * Inverse of:
   *
   * radius = usableRadius * seedScale / sqrt(count)
   */
  const displayLimit = Math.max(
    1,
    Math.floor(
      Math.pow(
        (usableRadius * safeSeedScale) / minimumRadius,
        2,
      ),
    ),
  );

  return Math.min(displayLimit, safeMaxSeeds);
}

/**
 * Implements:
 *
 * if seeds.length > limit:
 *   seeds = [...new Set(seeds)]
 *   seeds = seeds.slice(0, limit)
 *
 * Set insertion order is preserved, so earlier input seeds remain closer
 * to the center.
 */
export function limitSunflowerSeeds<T>(
  seeds: readonly T[],
  limit: number,
  getSeedKey?: (seed: T, originalIndex: number) => unknown,
): readonly T[] {
  const safeLimit = Math.max(0, Math.floor(limit));

  if (safeLimit === 0) {
    return [];
  }

  /*
   * As requested, do not alter or deduplicate the list unless it first
   * exceeds the calculated limit.
   */
  if (seeds.length <= safeLimit) {
    return seeds;
  }

  const seen = new Set<unknown>();
  const result: T[] = [];

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];

    /*
     * With no custom key, this is equivalent to new Set(seeds):
     * - primitive strings deduplicate by value
     * - objects deduplicate by reference
     */
    const key = getSeedKey
      ? getSeedKey(seed, index)
      : seed;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(seed);

    /*
     * Stopping early avoids constructing the complete Set when there are
     * many more unique values than can be rendered.
     */
    if (result.length >= safeLimit) {
      break;
    }
  }

  return result;
}

export function Sunflower({
  diameter,
  seeds,
  padding,
  seedScale = DEFAULT_SEED_SCALE,
  seedRadius,
  minSeedDiameter = DEFAULT_MIN_SEED_DIAMETER,
  maxSeeds = DEFAULT_MAX_SEEDS,
  getSeedKey,
  rotation = -90,
  background = "none",
  borderColor = "currentColor",
  borderWidth = 1,
  ariaLabel,
  style,
  ...svgProps
}: SunflowerProps): React.ReactElement {
  const size = Math.max(1, diameter);
  const center = size / 2;

  const safeBorderWidth = Math.max(0, borderWidth);
  const safePadding = Math.max(0, padding ?? size * 0.035);
  const safeSeedScale = Math.max(0, seedScale);

  const boundaryRadius = Math.max(
    0,
    center - safeBorderWidth / 2,
  );

  const usableRadius = Math.max(
    0,
    boundaryRadius - safePadding,
  );

  const seedLimit = getSunflowerSeedLimit(size, {
    padding: safePadding,
    borderWidth: safeBorderWidth,
    seedScale: safeSeedScale,
    seedRadius,
    minSeedDiameter,
    maxSeeds,
  });

  const renderedSeeds = React.useMemo(
    () =>
      limitSunflowerSeeds(
        seeds,
        seedLimit,
        getSeedKey,
      ),
    [seeds, seedLimit, getSeedKey],
  );

  const count = renderedSeeds.length;

  const automaticSeedRadius =
    count === 0
      ? 0
      : Math.min(
          usableRadius * 0.32,
          (usableRadius * safeSeedScale) /
            Math.sqrt(count),
        );

  const actualSeedRadius = Math.min(
    usableRadius,
    Math.max(
      0,
      seedRadius ?? automaticSeedRadius,
    ),
  );

  /*
   * Keep the complete seed circle inside the available area.
   */
  const maximumCenterRadius = Math.max(
    0,
    usableRadius - actualSeedRadius,
  );

  const rotationRadians =
    (rotation * Math.PI) / 180;

  const label =
    ariaLabel ??
    `Sunflower visualization showing ${count} of ${seeds.length} seeds`;

  return (
    <svg
      {...svgProps}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-input-seed-count={seeds.length}
      data-rendered-seed-count={count}
      data-seed-limit={seedLimit}
      style={{
        display: "block",
        ...style,
      }}
    >
      <title>{label}</title>
      <circle
        cx={center}
        cy={center}
        r={boundaryRadius}
        fill={background}
        stroke={borderColor}
        strokeWidth={safeBorderWidth}
        vectorEffect="non-scaling-stroke"
      />

      {renderedSeeds.map((seed, index) => {
        const color =
          typeof seed === "string"
            ? seed
            : seed.color;

        const seedLabel =
          typeof seed === "string"
            ? undefined
            : seed.label;

        /*
         * sqrt(progress) distributes points approximately uniformly
         * across the circle's area.
         */
        const progress =
          count <= 1
            ? 0
            : index / (count - 1);

        const distance =
          maximumCenterRadius *
          Math.sqrt(progress);

        const angle =
          rotationRadians +
          index * GOLDEN_ANGLE;

        const x =
          center + Math.cos(angle) * distance;

        const y =
          center + Math.sin(angle) * distance;

        return (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={actualSeedRadius}
            fill={color}
            data-seed-index={index}
          >
            {seedLabel ? (
              <title>{seedLabel}</title>
            ) : null}
          </circle>
        );
      })}
    </svg>
  );
}

export function sunflower(
  diameter: number,
  seeds: readonly SunflowerSeed[],
  options: Omit<
    SunflowerProps,
    "diameter" | "seeds"
  > = {},
): React.ReactElement {
  return (
    <Sunflower
      {...options}
      diameter={diameter}
      seeds={seeds}
    />
  );
}

export type SemanticSunflowerTone =
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'neutral'

export interface SemanticSunflowerSeedModel {
  id: string
  label: string
  tone: SemanticSunflowerTone
}

export interface SemanticSunflowerModel {
  ariaLabel: string
  seeds: readonly SemanticSunflowerSeedModel[]
}

/** Fixed product colors used by the semantic adapter; domain callers provide tones, never hex. */
export const SUNFLOWER_TONE_COLORS: Readonly<Record<SemanticSunflowerTone, SunflowerColor>> = {
  primary: 'var(--primary)',
  danger: 'var(--destructive)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  neutral: 'var(--muted-foreground)'
}

function semanticSeedKey(seed: SunflowerSeed): unknown {
  return typeof seed === 'string' ? seed : seed.id
}

export function validateSemanticSunflowerModel(model: SemanticSunflowerModel): void {
  if (model.ariaLabel.trim().length === 0 || model.seeds.length === 0) {
    throw new Error('A semantic Sunflower requires an accessible label and at least one seed.')
  }
  const ids = new Set<string>()
  for (const seed of model.seeds) {
    if (!seed.id.trim() || !seed.label.trim() || ids.has(seed.id)) {
      throw new Error(`Semantic Sunflower contains an invalid seed "${seed.id}".`)
    }
    ids.add(seed.id)
  }
}

/** Receiver-owned adapter for compact, accessible status summaries such as sidebar icons. */
export function SemanticSunflower({
  model,
  diameter = 24,
  ...props
}: {
  model: SemanticSunflowerModel
  diameter?: number
} & Omit<
  SunflowerProps,
  'diameter' | 'seeds' | 'ariaLabel' | 'borderColor' | 'minSeedDiameter' | 'getSeedKey'
>): React.ReactElement {
  validateSemanticSunflowerModel(model)
  return (
    <Sunflower
      {...props}
      diameter={diameter}
      seeds={model.seeds.map((seed) => ({
        id: seed.id,
        color: SUNFLOWER_TONE_COLORS[seed.tone],
        label: seed.label
      }))}
      ariaLabel={model.ariaLabel}
      borderColor={SUNFLOWER_TONE_COLORS.primary}
      minSeedDiameter={1}
      getSeedKey={semanticSeedKey}
    />
  )
}
