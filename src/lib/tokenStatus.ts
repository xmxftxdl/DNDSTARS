import type { Token } from '../store/maps'
import { BURNING_ICON } from './burning'
import { IGNITE_DEFAULT_TURNS, IGNITE_ICON, IGNITE_STATUS_LABEL } from './ignite'
import { KNOCKBACK_DEFAULT_TURNS, KNOCKBACK_ICON, KNOCKBACK_STATUS_LABEL } from './knockback'
import { POISON_DEFAULT_TURNS, POISON_ICON } from './poison'
import { STUN_DEFAULT_TURNS, STUN_STATUS_LABEL } from './stun'

// [T5/C6] Single source of truth for every status label. MapsPage + combatStatus alias
// these instead of redefining the literals (no more '燃烧' in three places).
export const BURNING_STATUS_LABEL = '燃烧'
export const POISON_STATUS_LABEL = '中毒'
export const RESTRAINED_STATUS_LABEL = '束缚'
export const VULNERABLE_STATUS_LABEL = '脆弱'
export const NO_MOVE_STATUS_LABEL = '无法移动'

// [T5/C9] registry now covers ALL 8 token status fields (was 5 — restrained/vulnerable/
// no-move were missing despite being real Token fields, so anything iterating the registry
// silently skipped them; TokenStatusEditor now exposes them to the DM too).
export type TokenStatusKey =
  | 'knockback'
  | 'burning'
  | 'ignite'
  | 'poison'
  | 'stun'
  | 'restrained'
  | 'vulnerable'
  | 'noMove'

export interface TokenStatusDef {
  key: TokenStatusKey
  label: string
  icon: string
  emoji: string
  tokenField: keyof Pick<
    Token,
    | 'knockbackTurns'
    | 'burningTurns'
    | 'igniteTurns'
    | 'poisonTurns'
    | 'stunTurns'
    | 'restrainedTurns'
    | 'vulnerableTurns'
    | 'noMoveTurns'
  >
  conditionLabel: string
  defaultTurns: number
}

export const TOKEN_STATUS_DEFS: TokenStatusDef[] = [
  {
    key: 'knockback',
    label: '击飞',
    icon: KNOCKBACK_ICON,
    emoji: '⬆',
    tokenField: 'knockbackTurns',
    conditionLabel: KNOCKBACK_STATUS_LABEL,
    defaultTurns: KNOCKBACK_DEFAULT_TURNS,
  },
  {
    key: 'burning',
    label: BURNING_STATUS_LABEL,
    icon: BURNING_ICON,
    emoji: '🔥',
    tokenField: 'burningTurns',
    conditionLabel: BURNING_STATUS_LABEL,
    defaultTurns: 3,
  },
  {
    key: 'ignite',
    label: '点燃',
    icon: IGNITE_ICON,
    emoji: '🌋', // [T5/C10] distinct from burning's 🔥 (were both 🔥, visually identical)
    tokenField: 'igniteTurns',
    conditionLabel: IGNITE_STATUS_LABEL,
    defaultTurns: IGNITE_DEFAULT_TURNS,
  },
  {
    key: 'poison',
    label: POISON_STATUS_LABEL,
    icon: POISON_ICON,
    emoji: '☠️',
    tokenField: 'poisonTurns',
    conditionLabel: POISON_STATUS_LABEL,
    defaultTurns: POISON_DEFAULT_TURNS,
  },
  {
    key: 'stun',
    label: '眩晕',
    icon: '',
    emoji: '★',
    tokenField: 'stunTurns',
    conditionLabel: STUN_STATUS_LABEL,
    defaultTurns: STUN_DEFAULT_TURNS,
  },
  {
    key: 'restrained',
    label: RESTRAINED_STATUS_LABEL,
    icon: '',
    emoji: '🕸',
    tokenField: 'restrainedTurns',
    conditionLabel: RESTRAINED_STATUS_LABEL,
    defaultTurns: 1,
  },
  {
    key: 'vulnerable',
    label: VULNERABLE_STATUS_LABEL,
    icon: '',
    emoji: '💔',
    tokenField: 'vulnerableTurns',
    conditionLabel: VULNERABLE_STATUS_LABEL,
    defaultTurns: 1,
  },
  {
    key: 'noMove',
    label: NO_MOVE_STATUS_LABEL,
    icon: '',
    emoji: '⛓',
    tokenField: 'noMoveTurns',
    conditionLabel: NO_MOVE_STATUS_LABEL,
    defaultTurns: 1,
  },
]

export function getTokenStatusTurns(token: Token, key: TokenStatusKey): number {
  const def = TOKEN_STATUS_DEFS.find((d) => d.key === key)!
  return (token[def.tokenField] as number | undefined) ?? 0
}

export function buildTokenStatusPatch(
  key: TokenStatusKey,
  turns: number,
): Partial<Token> {
  const def = TOKEN_STATUS_DEFS.find((d) => d.key === key)!
  return { [def.tokenField]: turns > 0 ? turns : 0 }
}

export function syncCharacterCondition(
  conditions: string[],
  conditionLabel: string,
  active: boolean,
): string[] {
  const has = conditions.includes(conditionLabel)
  if (active && !has) return [...conditions, conditionLabel]
  if (!active && has) return conditions.filter((c) => c !== conditionLabel)
  return conditions
}
