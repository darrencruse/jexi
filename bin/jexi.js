import { interpreter } from '../src/index.js'
import { startRepl } from '../src/repl.js'

const isDeno = typeof Deno !== 'undefined'
const args = isDeno ? Deno.args : process.argv.slice(2)

// if they gave a filename:
if (args.length > 0 && !args[0].startsWith('-')) {
  const jexi = interpreter({}, { trace: false })

  // run it
  const result = await jexi.evaluate({ $run: args[0] })

  console.log(result)
} else {
  // eslint-disable-next-line no-console
  console.log('Starting Jexi REPL...')

  // imagining the repl will have it's own custom commands later on:
  const extensions = {}

  const jexi = interpreter(extensions, { trace: false })

  startRepl(jexi, jexi.createEnv())
}
