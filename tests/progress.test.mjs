// The bar must be provably honest (a measure, not a spinner) and provably
// silent on a non-TTY stream, without a real sweep or a real terminal. Both
// properties are tested here by injecting a fake stream.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProgress } from '../lib/progress.mjs'

function fakeStream (isTTY) {
  const chunks = []
  return { isTTY, chunks, write (s) { chunks.push(s); return true } }
}

test('a TTY tick writes one carriage-returned line, not a newline-terminated one', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 4, stream })
  bar.tick('Breach Tablet rare')
  assert.equal(stream.chunks.length, 1)
  assert.ok(stream.chunks[0].startsWith('\r'), 'should return to column 0, not scroll')
  assert.ok(!stream.chunks[0].endsWith('\n'), 'a mid-sweep tick must not end the line')
})

test('the bar fills in proportion to progress, not a guess', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 4, stream })
  bar.tick('a')
  const oneQuarter = stream.chunks[0].match(/\[([#-]+)\]/)[1]
  bar.tick('b'); bar.tick('c'); bar.tick('d')
  const full = stream.chunks[3].match(/\[([#-]+)\]/)[1]
  assert.ok(oneQuarter.split('#').length - 1 < full.split('#').length - 1,
    'more done should mean more filled')
  assert.equal(full, '#'.repeat(full.length), 'the last tick should be fully filled')
})

test('the count, a percentage, and the cell label all appear', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 4, stream })
  bar.tick('Breach Tablet rare')
  bar.tick('Breach Tablet magic')
  assert.match(stream.chunks[1], /2\/4/)
  assert.match(stream.chunks[1], /50%/)
  assert.match(stream.chunks[1], /Breach Tablet magic/)
})

test('the final tick leaves a line that survives — it ends with a newline', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 2, stream })
  bar.tick('a')
  assert.ok(!stream.chunks[0].endsWith('\n'), 'not yet done')
  bar.tick('b')
  assert.ok(stream.chunks[1].endsWith('\n'), 'the last frame must persist')
})

test('a log message on a TTY clears the bar line rather than corrupting it', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 4, stream })
  bar.tick('a')
  bar.log('  rate limit: waiting 61.0s — ip search is full')
  const written = stream.chunks[1]
  assert.ok(written.startsWith('\r'))
  assert.match(written, /rate limit: waiting 61\.0s/)
  assert.ok(written.endsWith('\n'), 'a log line must not be overwritten by the next tick')
})

test('on a non-TTY stream, a tick is a plain line, never a carriage return', () => {
  const stream = fakeStream(false)
  const bar = createProgress({ label: 'collecting', total: 2, stream })
  bar.tick('Breach Tablet rare')
  assert.ok(!stream.chunks[0].includes('\r'), 'no control characters for a log file')
  assert.ok(stream.chunks[0].endsWith('\n'))
  assert.match(stream.chunks[0], /Breach Tablet rare/)
})

test('on a non-TTY stream, a log message is also a plain line', () => {
  const stream = fakeStream(false)
  const bar = createProgress({ label: 'collecting', total: 2, stream })
  bar.log('  429 rate-limited; waiting 10s (attempt 1)')
  assert.equal(stream.chunks.length, 1)
  assert.ok(!stream.chunks[0].includes('\r'))
  assert.match(stream.chunks[0], /429 rate-limited/)
})

test('isTTY can be given explicitly, for a stream that lies about itself', () => {
  const stream = fakeStream(undefined)
  const bar = createProgress({ label: 'collecting', total: 1, stream, isTTY: true })
  bar.tick('a')
  assert.ok(stream.chunks[0].startsWith('\r'))
})

test('a total of zero does not divide by zero', () => {
  const stream = fakeStream(true)
  const bar = createProgress({ label: 'collecting', total: 0, stream })
  assert.doesNotThrow(() => bar.tick('a'))
})
