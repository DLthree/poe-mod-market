import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PATHS } from '../lib/site.mjs'

// A fault that no other test here could see, because every other test builds
// into a temporary directory and never asks git what it would keep.
//
// `.gitignore` held an unanchored `data/`, which matches at every level — so it
// matched `site/data/` too, and the three JSON files the page cannot work
// without were left out of the commit. The build was right, the tests passed,
// and the deployed page would have 404ed on every fetch.
//
// This asks git directly. Anything git will not commit cannot be published.
const repo = fileURLToPath(new URL('..', import.meta.url))

const ignored = (path) => {
  const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: repo })
  // 0 = ignored, 1 = not ignored, 128 = not a repository or git is missing.
  return r.status === 0 ? true : r.status === 1 ? false : null
}

test('nothing the site publishes is gitignored', (t) => {
  const probe = ignored('README.md')
  if (probe === null) {
    t.skip('git is not available here')
    return
  }
  assert.equal(probe, false, 'sanity: a tracked file must not read as ignored')

  const league = 'Runes of Aldur'
  for (const path of [
    'site/index.html', 'site/app.js', 'site/style.css', 'site/.nojekyll',
    'site/lib/regex-keys.mjs', 'site/lib/poe2.mjs', 'site/lib/trade-url.mjs',
    `site/${PATHS.leagues}`, `site/${PATHS.economy(league)}`, `site/${PATHS.fragments(league)}`
  ]) {
    assert.equal(ignored(path), false, `${path} is gitignored and would never be published`)
  }
})

// The other half of the same rule: the things that must NEVER be committed.
test('the session cookie and the archive stay out of the repository', (t) => {
  if (ignored('README.md') === null) {
    t.skip('git is not available here')
    return
  }
  for (const path of ['secrets.json', 'data/Runes of Aldur.db', 'data/cache/stats-poe2.json']) {
    assert.equal(ignored(path), true, `${path} must be ignored`)
  }
})
