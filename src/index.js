/* eslint-disable no-extra-parens, no-underscore-dangle, no-undef-init */
import _ from 'lodash'
import RJson from 'really-relaxed-json'
import { isSymbol, symbolToString, stringToSymbol, getFnSymbolForForm } from './utils.js'
import builtins from './registry.js'

const rjsonParser = RJson.createParser()

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
// extensions are a registry with keys of plainFunctions/keywordArgs/specialForms/macros/globals
// (extensions add to the builtins to create the initial environment)
// options are { trace: true|false } (more options to come)
export const interpreter = (extensions = {}, options = {}) => {
  // options.trace = true

  const globalEnv = {
    options,
    // "specialForms" are marked _special so we know not to eval their arguments:
    ...getRegistryTable(builtins, 'specialForms', '_special'),
    ...getRegistryTable(builtins, 'keywordArgs', '_keyword'),
    ...getRegistryTable(builtins, 'macros', '_macro'),
    ...getRegistryTable(builtins, 'plainFunctions', '_plain'),
    ...getRegistryTable(builtins, 'globals'),

    // note extensions can override builtins of the same name if they choose
    ...getRegistryTable(extensions, 'specialForms', '_special'),
    ...getRegistryTable(extensions, 'keywordArgs', '_keyword'),
    ...getRegistryTable(extensions, 'macros', '_macro'),
    ...getRegistryTable(extensions, 'plainFunctions', '_plain'),
    ...getRegistryTable(extensions, 'globals'),
  }

  // eslint-disable-next-line no-console
  const trace = (...args) => globalEnv.options.trace && console.log.apply(null, args)

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

  // create a new namespace environment extending a parent environment
  const createEnv = (parentEnv = globalEnv) => Object.create(parentEnv)

  const evaluate = async (form, env = createEnv()) => {
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
      result = _.get(env, symbolToString(form))
    } else {
      trace(`evaluate: passing ${form} thru as plain data`)
    }

    trace(`evaluate: returning ${JSON.stringify(result, null, 2)} for ${JSON.stringify(form, null, 2)}`)

    return result
  }

  // a convenience function for passing in a jexi (relaxed json) string
  // instead the already parsed jexi (JSON) forms 
  const evalJexiStr = (jexiSourceStr, env) => {
    const jsonStr = rjsonParser.stringToJson(jexiSourceStr)

    return evaluate(JSON.parse(jsonStr), env)
  }

  // this is the instance of the interpreter we return customized according
  // to the extensions they pass into the interpreter() creation function
  const theInterpreter = {
    evaluate,
    evalJexiStr,
    trace,
    createEnv,
    globals: globalEnv,
    isSymbol,
    getFnSymbolForForm,
    symbolToString,
    stringToSymbol,
  }

  const evaluateKeys = async (oform, env) => {
    // note it's important here to make a new object and not mutate the incoming form
    // (which may get reused e.g. in the body of a for/map/etc.)
    const evaluatedForm = {}

    // TBD evaluate these in parallel?  is there a reason not to?
    for await (const [ key, value ] of Object.entries(oform)) {
      evaluatedForm[key] = await evaluate(value, env)
    }

    return evaluatedForm
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
        trace(`evaluateObjectForm: calling the ${$fnSymbol} macro`)
        const expandedForm = await func(oform, env, theInterpreter)

        return evaluate(expandedForm, env)
      } else if (func?._special) {
        // special forms are called with their args unevaluated:
        trace(`evaluateObjectForm: calling the ${$fnSymbol} special form`)

        return func(oform, env, theInterpreter)
      } else if (typeof func === 'function') {
        if (func?._keyword) {
          const evaluatedForm = await evaluateKeys(oform, env)

          // keyword arg handlers get the evaluated form, env "context" and jexi interpreter:
          trace(`evaluateObjectForm: calling ${$fnSymbol} with keyword arguments`)

          return func(evaluatedForm, env, theInterpreter)
        } else if (func?._positional) {
          // positional arg (e.g. lambda) functions are passed the args array as their first parameter
          // (unlike plain functions where we actually spread the args array into multiple parameters)
          // evaluate the args before the call waiting for promises (if any) to settle first
          const args = oform[$fnSymbol]
          const argsArr = args ? _.castArray(args) : []
          // note here we need e.g. { $do: [...] } to evaluate the statements in order
          // TBD maybe later ad a "$doparallel" (i.e. they shouldn't *always* need to go in order?) 
          const evaluatedArgs = await mapAndWait(argsArr, arg => evaluate(arg, env))

          return func(evaluatedArgs, env, theInterpreter)
        }

        // plain functions are the default 
        // evaluate their args before the call waiting for promises (if any) to settle first
        const args = oform[$fnSymbol]
        const argsArr = args ? _.castArray(args) : []
        // note here we need e.g. { $do: [...] } to evaluate the statements in order
        // TBD maybe later offer a "$doparallel"? 
        const evaluatedArgs = await mapAndWait(argsArr, arg => evaluate(arg, env))

        // spread the evaluated args array as regular args (e.g. to work with 3rd party functions)
        trace(`evaluateObjectForm: calling the ${$fnSymbol} function (with positional args)`)

        return func(...evaluatedArgs)
      }

      // TBD this should probably change to being an error...
      // i.e. this is more likely a typo than an intention to pass thru data with $ in a key?
      trace(`evaluateObjectForm: passing thru object with unrecognized symbol key "${$fnSymbol}":`, JSON.stringify(oform, null, 2))
    }

    // note the following may be bad for performance with large payloads
    // they can use $quote/$json to mark data they know doesn't need to evaluated
    // TBD is defaulting to evaluating everything the best though?  could I
    //  have e.g. "$template" to indicate eval is needed everywhere but not 
    //  do that by default (maybe I use $ even on keyword arguments and only 
    //  evaluate those when not within a "$template"?)

    trace('evaluateObjectForm: evaluating key values of plain object as a template')

    return evaluateKeys(oform, env)
  }

  return theInterpreter
}

export default interpreter
