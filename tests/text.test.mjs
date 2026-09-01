import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plain } from '../lib/text.mjs'

test('a piped link keeps the right-hand side', () => {
  assert.equal(plain('Map has 30% increased number of [Rarity|Rare] Monsters'),
    'Map has 30% increased number of Rare Monsters')
})

test('a bare link keeps its only side', () => {
  assert.equal(plain('Map contains an additional [Shrine]'),
    'Map contains an additional Shrine')
})

test('several links in one line all resolve', () => {
  assert.equal(plain('Unstable [ContainsBreach|Breaches] spawn 3 [Rarity|Rare] Monsters'),
    'Unstable Breaches spawn 3 Rare Monsters')
})

test('text with no markup is unchanged', () => {
  assert.equal(plain('59% increased Quantity of Hiveblood found in Map'),
    '59% increased Quantity of Hiveblood found in Map')
})
