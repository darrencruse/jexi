/* eslint-disable no-undef-init */
import RJson from 'really-relaxed-json'
import { interpreter } from './index.js'
import repl from 'repl'
import util from 'util'

const rjsonParser = RJson.createParser()

const startRepl = (jexi, options = { relaxed: true }) => {
  const isRecoverableError = error => {
    if (error.name === 'ParseException') {
      return /^Expected/.test(error.message)
    }

    return false
  }

  let lastCommand = '?'

  // TBD SHOULD I BE USING THEIR PROVIDED CONTEXT OR WIRING IT TO OURS SOMEHOW?
  const replEval = async (cmd, _context, _filename, callback) => {
    let form = undefined
    let result = undefined

    const trimmedCmd = cmd?.trim()

    if (trimmedCmd) {
      try {
        const inputStr = options.relaxed ? rjsonParser.stringToJson(trimmedCmd) : trimmedCmd

        form = JSON.parse(inputStr)
      } catch (err) {
        // if they enter nothing and hit return we exit multiline mode and show the error   
        if (lastCommand !== trimmedCmd && isRecoverableError(err)) {
          lastCommand = trimmedCmd

          return callback(new repl.Recoverable(err))
        }

        result = `Invalid JSON please correct: ${err}`
      }

      if (form) {
        result = await jexi.evaluate(form)
        if (Array.isArray(result) && result.length > 0 && result[0]?.then) {
          result = await Promise.all(result)
        }
      }
    }

    lastCommand = trimmedCmd

    callback(null, result)
  }

  // fix the repl default showing [Object]/[Array] with JSON > 2 levels deep:
  const writeFullDepth = output => util.inspect(output, { depth: 100, colors: true })

  repl.start({
    eval: replEval,
    prompt: `${options.prompt || '>'} `,
    writer: writeFullDepth,
  })
}

// eslint-disable-next-line no-console
console.log('Starting Assembler REPL...')

const jexi = interpreter({ lodash: true, trace: false })

startRepl(jexi, { prompt: 'jexi>', relaxed: true })
