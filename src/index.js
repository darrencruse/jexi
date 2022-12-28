/* eslint-disable no-extra-parens, no-underscore-dangle, no-undef-init */
import RJson from 'really-relaxed-json'
import builtins from './registry.js'
import castArray from 'lodash.castarray'
import get from 'lodash.get'
import repl from 'repl'
import util from 'util'

const rjsonParser = RJson.createParser()

const getRegistrySpecialForms = registry => {
  if (!registry || !registry.specialForms) {
    return {}
  }

  // the "specialForms" are marked _special so we know not to eval their arguments
  Object.keys(registry.specialForms).forEach(key => {
    registry.specialForms[key]._special = true
  })

  return registry.specialForms
}

const getRegistryFunctions = registry => {
  if (!registry || !registry.functions) {
    return {}
  }

  // the "functions" are marked _formhandler since they receive and
  // handle the array and object form data directly.  this distinguishes
  // them from plain javascript functions (e.g. console.log) which can't
  // take the form data as arguments 
  Object.keys(registry.functions).forEach(key => {
    registry.functions[key]._formhandler = true
  })

  return registry.functions
}

// "globals" are plain javacript values added to the global variable scope
const getRegistryGlobals = registry => registry && registry.globals || {}

export const interpreter = (options = {}) => {
  // options.trace = true

  const globals = {
    trace: options.trace,
    ...getRegistrySpecialForms(builtins),
    ...getRegistrySpecialForms(options.registry),
    ...getRegistryFunctions(builtins),
    ...getRegistryFunctions(options.registry),
    ...getRegistryGlobals(builtins),
    ...getRegistryGlobals(options.registry),
  }

  // eslint-disable-next-line no-console
  const trace = (...args) => globals.trace && console.log.apply(null, args)

  // our "symbols" in JSON strings marked with a prefix "$"
  // but being sure to ignore money e.g. "$1.50" or syntax that may
  // arise when embedding *other* expression languages e.g.
  // jsonpath ("$.prop"), jsonata ("$max(array)") etc.
  const symRegex = new RegExp('^\\$[^$0-9][^(){}]*$')
  const isSymbol = atom => typeof atom === 'string' && symRegex.test(atom)

  // converting symbol to string just removes the $ prefix (if it has one)
  const symbolToString = symbolStr => isSymbol(symbolStr) ? symbolStr.substring(1) : String(symbolStr)

  // converting string to symbol just adds the $ prefix
  const stringToSymbol = str => !isSymbol(str) ? `$${str.trim()}` : str

  // return the "$function" symbol specified in the provided object form call { $function: [ args ] }.
  // Otherwise null if there isn't one
  const getFnSymbolForForm = form => {
    let fnSymbol = null

    const keys = Object.keys(form) || []
    const symbols = keys.filter(isSymbol)

    if (symbols.length > 0) {
      fnSymbol = symbols[0]

      if (symbols.length > 1) {
        console.warn(`Warning: ambiguous object form with multiple "$function" keys (using ${fnSymbol}):`)
      }
    }

    return fnSymbol
  }

  // map an async function to each element of the array, 
  // waiting for each to complete before doing the next 
  const mapAndWait = async (array, asyncFn) => {
    const results = []

    for (const element of array) {
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await asyncFn(element))
      } catch (err) {
        // TBD better error handling
        console.error('In mapAndWait exception:', err, 'processing element:', JSON.stringify(element, null, 2))
      }
    }

    return results
  }

  const evaluate = async (form, variables = globals, options = {}) => {
    trace('evaluate: evaluating:', JSON.stringify(form, null, 2))
    //trace('evaluate: evaluating with vars of:', JSON.stringify(variables, null, 2))
    let result = form

// DO I/DON'T I STILL NEED TO EVALUATE ELEMENTS OF ARRAYS?
// evaluateArrayForm USED TO DO THAT MAYBE I SHOULD HAVE KEPT THAT PART
// (EVEN IF THE LISPY STYLE HANDLING OF [$fn, arg1, ..., argN ]) went away?
// SO FAR IN TESTING I'M NOT SURE BUT MAYBE IT'S OK WITHOUT?  ALSO I HAVE { $do: [...] } FOR OP SEQUENCES
    if (typeof form === 'object') {
      // eslint-disable-next-line no-use-before-define
      result = await evaluateObjectForm(form, variables, options)
    } else if (isSymbol(form)) {
      trace(`evaluate: replacing "${form}" with variables.${symbolToString(form)}`)

      // note that we've chosen to omit the "$" prefix on the *actual* keys used in variables
      // (this was done to make variables set by the interpreter and variables set by plain
      // javascript be consistent rather than interpreter ones starting "$" and others not)
      result = get(variables, symbolToString(form))
    } else {
      trace(`evaluate: passing ${form} thru as plain data`)
    }

    trace(`evaluate: returning ${JSON.stringify(result, null, 2)} for ${JSON.stringify(form, null, 2)}`)

    return result
  }

  const startRepl = (options = { relaxed: true }) => {
    // TBD SHOULD I BE USING THEIR PROVIDED CONTEXT OR WIRING IT TO OURS SOMEHOW?
    const replEval = async (cmd, _context, _filename, callback) => {
      let form = undefined
      let result = undefined

      if (cmd && cmd.trim()) {
        try {
          const inputStr = options.relaxed ? rjsonParser.stringToJson(cmd.trim()) : cmd.trim()

          form = JSON.parse(inputStr)
        } catch (err) {
          result = `Invalid JSON please correct: ${err}`
        }

        if (form) {
          result = await evaluate(form)
          if (Array.isArray(result) && result.length > 0 && result[0].then) {
            result = await Promise.all(result)
          }
        }
      }

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

  // this is the instance of the interpreter we return customized according
  // to the options they pass into the interpreter() creation function
  const theInterpreter = {
    evaluate,
    globals,
    isSymbol,
    getFnSymbolForForm,
    repl: startRepl,
    symbolToString,
    stringToSymbol,
    trace,
  }

  // an object form is { $fnSymbol: [ arg1 ... argN ] }
  // or (for convenience) { $fnSymbol: arg } when there is only one argument
  // eslint-disable-next-line no-unused-vars
  const evaluateObjectForm = async (oform, variables, options = {}) => {
    const $fnSymbol = getFnSymbolForForm(oform)

    if ($fnSymbol) {
      // evaluate the symbol to a function
      // note this resolves e.g. "$console.log" which a simple variables[fname] wouldn't find
      const func = await evaluate($fnSymbol, variables, options)

      if (func && func._special) {
        // special forms are called with their args unevaluated:
        return func(oform[$fnSymbol], variables, theInterpreter)
      } else if (typeof func === 'function') {
        // regular forms have their args evaluated before they are called
        // the equivalent here is the values of all keys are evaluated before the fn is called
        // note: we also wait here for promises (if any) to settle before making the call
        const args = oform[$fnSymbol]
        const argsArr = args ? castArray(args) : []
        // WHAT WAS MY RATIONALE FOR ARG EVALS NOT RUNNING CONCURRENTLY??? 
        const evaluatedArgs = await mapAndWait(argsArr, arg => evaluate(arg, variables, options))

        trace(`evaluateObjectForm: calling ${$fnSymbol}`)

        const result = func._formhandler ?
// DOESNT A VARARGS FUNCTION CREATE ISSUES FOR THE variables/theInterpreter ARGS BELOW?
// THAT WOULD BE AN ARGUMENT FOR NOT SPREADING evaluatedArgs BELOW BUT RATHER HAVING THE
// HANDLER FUNCTIONS JUST RECEIEVE THE ARRAY OF EVALUATED ARGS AS THE FIRST ARG
// IT SEEMED LIKE REALLY THAT'S WHAT I WAS THINKING BELOW WITH THE "_formhandler" FLAG
// THAT A PLAIN JAVASCRIPT FUNCTION WOULD NOT BE MARKED "_formhandler"
          // handlers get the variables "context" and jexi interpreter along with the args:
          func(...evaluatedArgs, variables, theInterpreter) :
          // non-form handlers are plain javascript functions and get only the args
          // note e.g. $console.log would print the variables and interpreter 
          // if called as a handler like the above
          func(...evaluatedArgs)

        trace(`evaluateObjectForm: returning from calling ${$fnSymbol}`, result)

        return result
      }

      // TBD this should probably change to being an error...
      // i.e. this is more likely a typo than an intention to pass thru data with $ in a key?
      trace(`evaluateObjectForm: passing thru object with unrecognized symbol key "${$fnSymbol}":`, JSON.stringify(oform, null, 2))
    }

    // IS THIS DEFINITELY WHAT I SHOULD DO HERE?
    // CANT I ASSUME AN OBJECT WITHOUT A { $fn: [] } FORM IS JUST JSON ALL THE WAY DOWN?
    // IF NOT THEN EVALUATING ALL THE ELEMENTS IN AN ARRAY SEEMS TO PARALLEL THIS BUT I DELETED THAT!!??
    // AREN'T THESE TWO THINGS BAD FOR PERFORMANCE THOUGH?
    // WHAT IF ITS A LIVE ASSEMBLER RUN WITH MEGABYTES OF PAYLOAD JSON AND I'M RUNNING OVER THE WHOLE ARRAYS?
    // IF I'M MODELING LISPY STYLE LANGUAGE WHY ISN'T THERE LIKE { $quote: [ json ] } TO STOP THE RECURSION?
    trace('evaluateObjectForm: evaluating key values of plain object as a template')

    // note: we also wait here for promises (if any) to settle
    const keys = Object.keys(oform) || []

    await mapAndWait(keys, async key => {
      const evaluated = await evaluate(oform[key], variables)

      oform[key] = evaluated
    })

    return oform
  }

  return theInterpreter
}

export default interpreter
