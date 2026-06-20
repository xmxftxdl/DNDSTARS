import { BURNING_DAMAGE_PER_TURN } from './burning'
import { IGNITE_DAMAGE_PER_TURN } from './ignite'
import { POISON_DAMAGE_PER_TURN } from './poison'

/**
 * [T3/C1] Per-tick damage-over-time total for a token, summed across all active DOT
 * statuses (burning / ignite / poison). Pure + side-effect-free so the round-tick
 * behavior is unit-testable (T13) without mounting the page. A counter of 0 (or
 * undefined) contributes nothing — the no-DOT branch returns 0.
 */
export function dotDamageFor(token: {
  burningTurns?: number
  igniteTurns?: number
  poisonTurns?: number
}): number {
  let total = 0
  if (token.burningTurns && token.burningTurns > 0) total += BURNING_DAMAGE_PER_TURN
  if (token.igniteTurns && token.igniteTurns > 0) total += IGNITE_DAMAGE_PER_TURN
  if (token.poisonTurns && token.poisonTurns > 0) total += POISON_DAMAGE_PER_TURN
  return total
}
