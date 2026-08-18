const MIN_THREAD_HUE_DISTANCE = 22

interface TimelineThreadColorSource {
  id: number
}

function hashThreadId(threadId: number): number {
  let hash = 2_166_136_261
  for (const character of `thread:${threadId}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right)
  return Math.min(distance, 360 - distance)
}

export function focusTimelineThreadColors(
  threads: TimelineThreadColorSource[]
): Map<number, string> {
  const colors = new Map<number, string>()
  const usedHues: number[] = []

  for (const thread of [...threads].sort((left, right) => left.id - right.id)) {
    const baseHue = (hashThreadId(thread.id) % 3_600) / 10
    let hue = baseHue
    let attempt = 0
    while (
      attempt < 360 &&
      usedHues.some((usedHue) => hueDistance(usedHue, hue) < MIN_THREAD_HUE_DISTANCE)
    ) {
      attempt += 1
      hue = (baseHue + attempt * 137.508) % 360
    }
    let roundedHue = Number(hue.toFixed(1))
    while (usedHues.includes(roundedHue)) {
      roundedHue = Number(((roundedHue + 0.1) % 360).toFixed(1))
    }
    usedHues.push(roundedHue)
    colors.set(thread.id, `hsl(${roundedHue} 58% 43%)`)
  }

  return colors
}
