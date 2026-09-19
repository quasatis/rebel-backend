'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = '/opt/app'
const REQUIRED = ['src/index.ts', 'config/database.ts']
const TIMEOUT_MS = 90_000
const INTERVAL_MS = 1_000

function missing() {
  return REQUIRED.filter((file) => !fs.existsSync(path.join(ROOT, file)))
}

function run() {
  const [command, ...args] = process.argv.slice(2)
  if (!command) {
    console.error('docker-entrypoint: missing command')
    process.exit(1)
  }

  const child = spawn(command, args, { stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

function waitForSources(startedAt = Date.now()) {
  const absent = missing()
  if (!absent.length) {
    run()
    return
  }

  if (Date.now() - startedAt > TIMEOUT_MS) {
    console.error(
      `docker-entrypoint: timed out waiting for ${absent.join(', ')}. ` +
        'TypeScript needs those files before Strapi can compile.',
    )
    process.exit(1)
  }

  console.log(`Waiting for source files (${absent.join(', ')})...`)
  setTimeout(() => waitForSources(startedAt), INTERVAL_MS)
}

waitForSources()
