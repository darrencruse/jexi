/* eslint-disable no-undef-init */
import RJson from 'really-relaxed-json'
import { interpreter } from './index.js'
import repl from 'repl'
import util from 'util'

const rjsonParser = RJson.createParser()

const defaultOpts = { prompt: 'jexi>', relaxed: true }

const startRepl = (jexi, env, replopts = defaultOpts) => {
  const isRecoverableError = error => {
    if (error.name === 'ParseException') {
      return /^Expected/.test(error.message)
    }

    return false
  }

  let lastCommand = '?'

  const replEval = async (cmd, _context, _filename, callback) => {
    let form = undefined
    let results = undefined

    const trimmedCmd = cmd?.trim()

    if (trimmedCmd) {
      try {
        const inputStr = replopts.relaxed ? rjsonParser.stringToJson(trimmedCmd) : trimmedCmd

        form = JSON.parse(inputStr)
      } catch (err) {
        // if they enter nothing and hit return we exit multiline mode and show the error   
        if (lastCommand !== trimmedCmd && isRecoverableError(err)) {
          lastCommand = trimmedCmd

          return callback(new repl.Recoverable(err))
        }

        results = `Invalid JSON please correct: ${err}`
      }

      if (form) {
        results = await jexi.evaluate(form, env)
        if (Array.isArray(results) && results.length > 0 &&
          results.some(result => typeof result?.then === 'function')) {
          results = await Promise.all(results)
        }
      }
    }

    lastCommand = trimmedCmd

    callback(null, results)
  }

  // fix the repl default showing [Object]/[Array] with JSON > 2 levels deep:
  const writeFullDepth = output => util.inspect(output, { depth: 100, colors: true })

  repl.start({
    eval: replEval,
    prompt: `${replopts.prompt || '>'} `,
    writer: writeFullDepth,
  })
}

// eslint-disable-next-line no-console
console.log('Starting Jexi REPL...')

// imagining the repl will have it's own custom commands later on:
const extensions = { }

const jexi = interpreter(extensions, { trace: false })

startRepl(jexi, jexi.createEnv())
