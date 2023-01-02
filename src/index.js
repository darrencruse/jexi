/* eslint-disable no-extra-parens, no-underscore-dangle, no-undef-init */
import builtins from './registry.js'
import castArray from 'lodash.castarray'
import get from 'lodash.get'

const getRegistryTable = (registry, tableKey, typeFlag = '') => {
  const lookupTable = registry?.[tableKey] || {}

  if (typeFlag) {
    Object.keys(lookupTable).forEach(key => {
      lookupTable[key][typeFlag] = true
    })
  }

  return lookupTable
}

// construct and return a new interpreter
// extensions are a registry with keys of specialForms/handlers/functions/macros/globals
// (extensions add to the builtins to create the initial environment)
// options are { trace: true|false } (more options to come)
export const interpreter = (extensions = {}, options = {}) => {
  // options.trace = true

  const globalEnv = {
    options,
    // "specialForms" are marked _special so we know not to eval their arguments:
    ...getRegistryTable(builtins, 'specialForms', '_special'),
    // "handlers" are marked _handler so we know to pass them env and jexi.evaluate:
    ...getRegistryTable(builtins, 'handlers', '_handler'),
    ...getRegistryTable(builtins, 'macros', '_macro'),
    ...getRegistryTable(builtins, 'functions'),
    ...getRegistryTable(builtins, 'globals'),

    // note extensions can override builtins of the same name if they choose
    ...getRegistryTable(extensions, 'specialForms', '_special'),
    ...getRegistryTable(extensions, 'handlers', '_handler'),
    ...getRegistryTable(extensions, 'macros', '_macro'),
    ...getRegistryTable(extensions, 'functions'),
    ...getRegistryTable(extensions, 'globals'),
  }

  // eslint-disable-next-line no-console
  const trace = (...args) => globalEnv.options.trace && console.log.apply(null, args)

  // our "symbols" in JSON strings marked with a prefix "$"
  // but being sure to ignore money e.g. "$1.50" or syntax that may
  // arise when embedding *other* expression languages e.g.
  // jsonpath ("$.prop"), jsonata ("$max(array)") etc.
  const symRegex = new RegExp('^\\$[^$0-9\\.\\[][^(){}]*$')
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

  const evaluate = async (form, env = globalEnv) => {
    trace('evaluate: evaluating:', JSON.stringify(form, null, 2))
    //trace('evaluate: evaluating with vars of:', JSON.stringify(env, null, 2))
    let result = form

    // $env and $globals are handled specially
    // TBD add a way for e.g. "$env" invoke a function without the need for the { $env: null } syntax?
    switch (form) {
      case '$env': return env
      case '$globals': return globalEnv
      default: break
    }

    // note the below does evaluate their entire json { $fn } expressions even down
    // within the json.  i.e. like a template language.
    // TBD not sure this is best default (e.g. performance might suffer on large data) 
    if (Array.isArray(form)) {
      // normally we wait for each step to complete
      // (later functions might depend on the output of earlier ones)
      // eslint-disable-next-line no-use-before-define
      result = await mapAndWait(form, element => evaluate(element, env))
    } else if (typeof form === 'object') {
      // eslint-disable-next-line no-use-before-define
      result = await evaluateObjectForm(form, env)
    } else if (isSymbol(form)) {
      trace(`evaluate: replacing "${form}" with ${symbolToString(form)} from the environment`)

      // note that we've chosen to omit the "$" prefix on the *actual* keys used in variables
      // (this was done to make variables set by the interpreter and variables set by plain
      // javascript be consistent rather than interpreter ones starting "$" and others not)
      result = get(env, symbolToString(form))
    } else {
      trace(`evaluate: passing ${form} thru as plain data`)
    }

    trace(`evaluate: returning ${JSON.stringify(result, null, 2)} for ${JSON.stringify(form, null, 2)}`)

    return result
  }

  // create a new namespace environment extending a parent environment
  const createEnv = (parentEnv = globalEnv) => Object.create(parentEnv)

  // this is the instance of the interpreter we return customized according
  // to the extensions they pass into the interpreter() creation function
  const theInterpreter = {
    evaluate,
    trace,
    createEnv,
    globals: globalEnv,
    isSymbol,
    getFnSymbolForForm,
    symbolToString,
    stringToSymbol,
  }

  // an object form is { $fnSymbol: [ arg1 ... argN ] }
  // or (for convenience) { $fnSymbol: arg } when there is only one argument
  // eslint-disable-next-line no-unused-vars
  const evaluateObjectForm = async (oform, env) => {
    const $fnSymbol = getFnSymbolForForm(oform)

    if ($fnSymbol) {
      // evaluate the symbol to a function
      // note this resolves e.g. "$console.log" which a simple env[fname] wouldn't find
      const func = await evaluate($fnSymbol, env)

      if (func?._macro) {
        // a macro just returns another form to evaluate:
        const expandedForm = await func(oform[$fnSymbol], env, theInterpreter)

        return evaluate(expandedForm, env)
      } else if (func?._special) {
        // special forms are called with their args unevaluated:
        return func(oform[$fnSymbol], env, theInterpreter)
      } else if (typeof func === 'function') {
        // regular forms have their args evaluated before they are called
        // the equivalent here is the values of all keys are evaluated before the fn is called
        // note: we also wait here for promises (if any) to settle before making the call
        const args = oform[$fnSymbol]
        const argsArr = args ? castArray(args) : []
        // note here we need e.g. { $do: [...] } to evaluate the statements in order
        // TBD maybe later offer a "$doparallel"? 
        const evaluatedArgs = await mapAndWait(argsArr, arg => evaluate(arg, env))

        trace(`evaluateObjectForm: calling ${$fnSymbol}`)

        const result = func._handler ?
          // handlers get the evaluated args, env "context" and jexi interpreter:
          func(evaluatedArgs, env, theInterpreter) :
          // plain (non "handler") functions get the evaluated args spread as their args
          func(...evaluatedArgs)

        trace(`evaluateObjectForm: returning from calling ${$fnSymbol}`, result)

        return result
      }

      // TBD this should probably change to being an error...
      // i.e. this is more likely a typo than an intention to pass thru data with $ in a key?
      trace(`evaluateObjectForm: passing thru object with unrecognized symbol key "${$fnSymbol}":`, JSON.stringify(oform, null, 2))
    }

    // note the following may be bad for performance with large payloads
    // they can use $quote/$json to mark data they know doesn't need to evaluated
    // TBD is defaulting to evaluating everything the best though?  could I
    //  have e.g. "$template" to indicate eval is needed everywhere but not 
    //  do that by default (maybe I use $ even on named arguments and only 
    //  evaluate those when not within a "$template"?)

    trace('evaluateObjectForm: evaluating key values of plain object as a template')

    // note it's important here to make a new object and not mutate the incoming form
    // (which may get reused e.g. in the body of a for/map/etc.)
    const evaluated = {}

    for await (const [ key, value ] of Object.entries(oform)) {
      evaluated[key] = await evaluate(value, env)
    }

    return evaluated
  }

  return theInterpreter
}

export default interpreter
