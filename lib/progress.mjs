// A progress bar for a sweep whose size is known before it starts. The total
// is a count, never a guess, so the bar measures rather than spins.
//
// Writes to an injected stream, one line per unit of work. On a TTY it
// redraws a single line with `\r`; the last tick ends with a newline so its
// final state survives whatever prints next. On a non-TTY stream (piped,
// redirected, or a log file) it never writes a carriage return — one plain
// line per tick instead, so nothing that reads the output breaks.
//
// Pure: numbers and strings in, writes to a stream out. No trade client, no
// database, no phase-1 import.

const BAR_WIDTH = 30
const LINE_WIDTH = 100

function renderBar (done, total) {
  const frac = total > 0 ? Math.min(done / total, 1) : 1
  const filled = Math.round(frac * BAR_WIDTH)
  return '#'.repeat(filled) + '-'.repeat(BAR_WIDTH - filled)
}

function renderLine (label, done, total, cellLabel) {
  const digits = String(total).length
  const count = `${String(done).padStart(digits)}/${total}`
  const pct = String(Math.round((total > 0 ? done / total : 1) * 100)).padStart(3)
  return `${label.padEnd(12)} [${renderBar(done, total)}]  ${count}  ${pct}%   ${cellLabel}`
}

/**
 * Creates a progress reporter for a sweep of known size.
 *
 * @param {object} opts
 * @param {string} opts.label Short word shown at the left of the bar.
 * @param {number} opts.total Total number of ticks expected.
 * @param {{write: (s: string) => void, isTTY?: boolean}} [opts.stream] Where to
 *   write. Defaults to `process.stderr`.
 * @param {boolean} [opts.isTTY] Overrides `stream.isTTY`, for a stream that
 *   does not report it accurately.
 * @returns {{tick: (cellLabel?: string) => void, log: (message: string) => void}}
 */
export function createProgress ({ label, total, stream = process.stderr, isTTY }) {
  const tty = isTTY ?? stream.isTTY
  let done = 0

  function tick (cellLabel = '') {
    done += 1
    const line = renderLine(label, done, total, cellLabel)
    if (tty) {
      const end = done >= total ? '\n' : ''
      stream.write(`\r${line.padEnd(LINE_WIDTH)}${end}`)
    } else {
      stream.write(`${line}\n`)
    }
  }

  function log (message) {
    if (tty) {
      stream.write(`\r${' '.repeat(LINE_WIDTH)}\r${message}\n`)
    } else {
      stream.write(`${message}\n`)
    }
  }

  return { tick, log }
}
