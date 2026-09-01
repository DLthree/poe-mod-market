import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// Phase 2 reads the `observation` view and `listing_mod`, and nothing else. If
// it ever branches on how a row was collected, a new collector stops being a
// drop-in replacement and the phase boundary becomes decorative. That is a rule
// about source code, so it is tested as one.
//
// This is EXEMPT, not PHASE2: every .mjs file under lib/ that is not named here
// is assumed phase 2 and checked below. A hand-maintained PHASE2 list leaves a
// new module unguarded until someone remembers to add it; a hand-maintained
// EXEMPT list fails closed instead, because it is checked on every run.
const EXEMPT = [
  'archive.mjs', 'derive.mjs', 'sweep.mjs', // phase 1
  'db.mjs', // its view definition contains "JOIN request"
  'stat-index.mjs', // takes a `client`
  // The network layer itself. In the workspace this code was extracted from
  // these three sat a level above and could not be mistaken for phase 2; here
  // they are lib/ like everything else, so they have to be named.
  'trade-client.mjs', 'rate-limiter.mjs', 'request-log.mjs'
]

const libDir = new URL('../lib/', import.meta.url)
const PHASE2 = readdirSync(libDir)
  .filter(f => f.endsWith('.mjs') && !EXEMPT.includes(f))
  .sort()

const BANNED = [
  'request.kind', 'request.cell', 'from request', 'join request',
  'recordRequest', 'deriveRequest', 'sweepPools', 'sweepAffixes'
]

for (const file of PHASE2) {
  test(`${file} does not know how a row was collected`, () => {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    // Strip comments: the boundary is about behaviour, and the comments explain
    // the very thing they must not do.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of BANNED) {
      assert.ok(!code.toLowerCase().includes(banned.toLowerCase()),
        `${file} must not reference ${banned}`)
    }
  })
}

test('only the rate refresher touches the network, and nothing else in phase 2', () => {
  for (const file of PHASE2) {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    assert.ok(!src.includes('TradeClient'), `${file} must not construct a client`)
    assert.ok(!src.includes('client.'), `${file} must not call a client`)
  }
})

test('phase 2 imports nothing from phase 1', () => {
  const PHASE1 = ['archive.mjs', 'derive.mjs', 'sweep.mjs']
  for (const file of PHASE2) {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    // Strip comments, same as above: this is about real imports, not prose
    // that happens to mention a phase-1 filename.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const p1 of PHASE1) {
      assert.ok(!code.includes(p1), `${file} must not import ${p1}`)
    }
  }
})

test('the floor rule is reachable from one file only', () => {
  const others = ['walk.mjs', 'report.mjs', 'pools.mjs', 'summary.mjs', 'snapshots.mjs']
  for (const file of others) {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')
    const code = src.replace(/\/\/.*$/gm, '')
    // Only floor.mjs may name a strategy. Everywhere else takes it from config.
    for (const s of ['nth-cheapest-seller-recent', 'nth-cheapest-seller', 'nth-cheapest']) {
      assert.ok(!code.includes(`'${s}'`),
        `${file} hard-codes the floor rule "${s}"; it belongs in floor.mjs`)
    }
  }
})
