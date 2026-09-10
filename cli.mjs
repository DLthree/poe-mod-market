#!/usr/bin/env node
// The one front door. Four subcommands: update, serve, audit, build.
//
// `update` shells out to steps/*.mjs with spawnSync, on purpose: each step is
// the same script a human would run, so this orchestrator cannot drift from
// the thing it orchestrates. `serve` and `audit` are read-only, so
// that anti-drift argument does not apply to them and they are called in
// process instead — see docs/sweep-cli-design.md.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { runServe } from './web/serve.mjs'
import { runAudit } from './audit-db.mjs'
import { runBuild } from './steps/build-site.mjs'
import { KIND_KEYS, kindByKey } from './lib/item-kinds.mjs'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const config = JSON.parse(readFileSync(here('./config.json'), 'utf8'))

const OVERALL_USAGE = `Price CLI for PoE2 Precursor Tablets and jewels.

  node cli.mjs update [flags]   collect and rebuild the price data, one kind
  node cli.mjs serve  [flags]   the read-only web view and economy file
  node cli.mjs audit  [flags]   check stored rows against what GGG sent
  node cli.mjs build  [flags]   write the static site into site/

Run \`node cli.mjs <command> --help\` for a command's own flags.`

const UPDATE_BOOLEAN = ['help', 'offline', 'pools-only', 'dry-run', 'replay', 'quick']
const UPDATE_VALUED = ['league', 'data', 'kind']

const UPDATE_USAGE = `Refresh everything for one league.

  node cli.mjs update                collect every cell, rebuild the table  (~2 hours)
  node cli.mjs update --quick        baselines, plus the modifiers already
                                     worth ${config.quick?.minRatio ?? '?'}x or more                  (~35 min)
  node cli.mjs update --pools-only   only the type x rarity baselines       (~2 min)
  node cli.mjs update --offline      no collection: replay and rebuild
  node cli.mjs update --dry-run      print the plan and stop
  node cli.mjs update --replay       also replay the archive first

  --league <name>   default ${config.league}
  --kind <key>      which item kind to collect: ${KIND_KEYS.join(', ')}. Default tablet.
  --data <dir>      override the data directory

ONE KIND PER RUN, and that is a rate limit, not a preference. An IP may make 600
searches in six hours, and a full tablet pass is about 520 of them, so a tablet
pass and a jewel pass do not fit in one window. Run them apart.

--quick REFRESHES, it does not discover. It re-asks the modifiers the last pass
already measured at ${config.quick?.minRatio ?? '?'}x the blank tablet or better, so a modifier that has
become valuable since keeps its old floor until a full pass. Every baseline is
re-asked in full, which is what keeps the published ratios honest: the floors
above them are then at most lookbackHours old, exactly as after --rarities.
Set the threshold in config.json under "quick".

Replay is NOT part of a normal update. steps/collect.mjs stores the rank the
server's own price ordering gave each listing; a replay cannot restore it, and
lib/floor.mjs prefers rank over the raw amount. Replaying straight after
collecting would throw away the freshest signal in the data. Use --replay after
changing the parser, when re-reading old responses is the point.`

// Refusing an unknown flag is the whole safety property: the default path
// spends half an hour and a chunk of the day's rate allowance.
function parseUpdateFlags (argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      console.error(`Unexpected argument "${arg}".\n\n${UPDATE_USAGE}`)
      process.exit(2)
    }
    const name = arg.slice(2)
    if (UPDATE_BOOLEAN.includes(name)) opts[name] = true
    else if (UPDATE_VALUED.includes(name)) opts[name] = argv[++i]
    else {
      console.error(`Unknown flag "--${name}". Nothing has run.\n\n${UPDATE_USAGE}`)
      process.exit(2)
    }
  }
  return opts
}

// Each step is the same script you would run by hand, so nothing here is a
// second implementation that can drift from the one it copies.
function planUpdateSteps (opts) {
  const steps = []
  if (!opts.offline) {
    const quick = opts.quick ? ['--min-ratio', String(config.quick.minRatio)] : []
    const kind = opts.kind ?? 'tablet'
    steps.push({
      name: opts['pools-only']
        ? `collect the ${kind} baselines`
        : (opts.quick ? `collect the ${kind} baselines and the modifiers worth watching`
                      : `collect every ${kind} cell`),
      script: 'steps/collect.mjs',
      args: ['--kind', kind, '--full', '--i-mean-it',
        ...(opts['pools-only'] ? ['--only', 'pools'] : quick)]
    })
  }
  if (opts.offline || opts.replay) {
    steps.push({ name: 'replay the archive', script: 'steps/rederive.mjs', args: [] })
  }
  steps.push({ name: 'rebuild the modifier table', script: 'steps/build-mod-table.mjs', args: [] })
  return steps
}

function runSteps (steps, common) {
  const started = Date.now()
  for (const [i, step] of steps.entries()) {
    console.log(`\n=== ${i + 1}/${steps.length}  ${step.name}  (${step.script})\n`)
    const r = spawnSync(process.execPath, [here(`./${step.script}`), ...step.args, ...common],
      { stdio: 'inherit' })
    // Stopping matters more than finishing: a later step would otherwise read
    // half-updated data and report a number as though nothing had gone wrong.
    if (r.status !== 0) {
      console.error(`\n${step.script} exited ${r.status}. Stopped before the remaining ` +
        `${steps.length - i - 1} step(s), so nothing downstream ran on partial data.`)
      process.exit(r.status ?? 1)
    }
  }
  console.log(`\ndone in ${Math.round((Date.now() - started) / 60000)} min.` +
    '\nserve it:  node cli.mjs serve --host 0.0.0.0')
}

function cmdUpdate (argv) {
  const opts = parseUpdateFlags(argv)
  if (opts.help) {
    console.log(UPDATE_USAGE)
    return
  }
  // A flag that is quietly ignored is worse than one that is refused: --quick
  // asks for a narrower collection, and both of these mean no collection at
  // all or a different one, so accepting the pair would spend the wrong hour.
  if (opts.quick && opts['pools-only']) {
    console.error('--quick and --pools-only ask for different collections. Nothing has run.')
    process.exit(2)
  }
  if (opts.quick && opts.offline) {
    console.error('--quick narrows a collection and --offline makes none. Nothing has run.')
    process.exit(2)
  }
  if (opts.quick && !(Number(config.quick?.minRatio) > 0)) {
    console.error('config.json needs `quick.minRatio` as a positive number for --quick. ' +
      'Nothing has run.')
    process.exit(2)
  }
  // Checked here as well as in the step, so an unknown kind is refused before a
  // plan is printed saying it will collect one.
  if (opts.kind !== undefined) {
    try {
      kindByKey(opts.kind)
    } catch (err) {
      console.error(`${err.message} Nothing has run.`)
      process.exit(2)
    }
  }
  const league = opts.league ?? config.league
  const common = ['--league', league, ...(opts.data ? ['--data', opts.data] : [])]
  const steps = planUpdateSteps(opts)

  console.log(`league: ${league}`)
  for (const [i, s] of steps.entries()) {
    console.log(`  ${i + 1}. ${s.name.padEnd(28)} ${s.script} ${s.args.join(' ')}`)
  }
  if (opts['dry-run']) {
    console.log('\ndry run: nothing has been collected, written or rebuilt.')
    return
  }
  runSteps(steps, common)
}

const COMMANDS = { update: cmdUpdate, serve: runServe, audit: runAudit, build: runBuild }

function main () {
  const argv = process.argv.slice(2)
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(OVERALL_USAGE)
    process.exit(0)
  }
  if (argv.length === 0) {
    console.error(`No command given. Nothing has run.\n\n${OVERALL_USAGE}`)
    process.exit(2)
  }
  const [command, ...rest] = argv
  const handler = COMMANDS[command]
  if (!handler) {
    console.error(`Unknown command "${command}". Nothing has run.\n\n${OVERALL_USAGE}`)
    process.exit(2)
  }
  handler(rest)
}

main()
