#!/usr/bin/env NODE_TLS_REJECT_UNAUTHORIZED=0 node

import { jexiInterpreter } from '../src/index.js'
import { startRepl } from '../src/repl.js'
import nodeSpecificExtensions from '../src/non-browser.js'

// if they gave a filename:
if (process.argv.length > 2 && !process.argv[2].startsWith('-')) {
  const jexi = jexiInterpreter(nodeSpecificExtensions, { trace: false })

  // run it
  const result = await jexi.evaluate({ $run: process.argv[2] })

  console.log(result)
} else {
  // eslint-disable-next-line no-console
  console.log('Starting Jexi REPL...')

  // imagining the repl may have additional commands (as extensions) later on:
  const extensions = nodeSpecificExtensions

  const jexi = jexiInterpreter(extensions, { trace: false })

  startRepl(jexi, jexi.createEnv())
}
