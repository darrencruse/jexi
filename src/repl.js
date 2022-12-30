/* eslint-disable no-undef-init */
import RJson from 'really-relaxed-json'
import { interpreter } from './index.js'
import { readFileSync } from 'node:fs'
import repl from 'repl'
import util from 'util'

const rjsonParser = RJson.createParser()

const defaultOpts = { prompt: 'jexi>', relaxed: true }

const startRepl = (jexi, replopts = defaultOpts) => {
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
        results = await jexi.evaluate(form)
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

const extensions = {
  handlers: {
    // they can do:
    //  { $read: 'path/to/file.json' }
    // to read and evaluate the contents of a (relaxed or standard) json file
    read: ([ filename ], env, jexi) => {
      let jsonStr = undefined

      try {
        jsonStr = readFileSync(filename, 'utf8')
      } catch (err) {
        return `Could not read file ${filename}: $(err)`
      }

      // eslint-disable-next-line no-console
      console.log(jsonStr)

      let forms = undefined

      try {
        const inputStr = defaultOpts.relaxed ? rjsonParser.stringToJson(jsonStr) : jsonStr

        forms = JSON.parse(inputStr)
      } catch (err) {
        return `The file contains invalid JSON: ${err}`
      }

      return jexi.evaluate(forms, env)
    },
  },
}

const jexi = interpreter(extensions, { trace: false })

startRepl(jexi)
