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
export const jexiInterpreter = (extensions = {}, options = {}) => {
  // options.trace = true

  const globalEnv = {
    options,
    // "specialForms" are marked _special so we know not to eval their arguments:
    ...getRegistryTable(builtins, 'specialForms', '_special'),
    ...getRegistryTable(builtins, 'keywordArgs', '_keyword'),
    ...getRegistryTable(builtins, 'macros', '_macro'),
    ...getRegistryTable(builtins, 'plainFunctions', '_plain'),
    ...getRegistryTable(builtins, 'handlers'),
    ...getRegistryTable(builtins, 'globals'),

    // note extensions can override builtins of the same name if they choose
    ...getRegistryTable(extensions, 'specialForms', '_special'),
    ...getRegistryTable(extensions, 'keywordArgs', '_keyword'),
    ...getRegistryTable(extensions, 'macros', '_macro'),
    ...getRegistryTable(extensions, 'handlers'),
    ...getRegistryTable(extensions, 'plainFunctions', '_plain'),
  }

  // eslint-disable-next-line no-console
  const trace = (...args) => globalEnv.options.trace && globalEnv.log(...args)

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

  // this is the instance of the interpreter we return customized according
  // to the extensions they pass into the jexiInterpreter() creation function
  const theInterpreter = {
    evaluate,
    evalJexiStr,
    evaluateKeys,
    trace,
    createEnv,
    globals: globalEnv,
    isSymbol,
    getFnSymbolForForm,
    symbolToString,
    stringToSymbol,
  }

  // invoke their custom "handler" (if they've overriden ours) but if it returns undefined
  // fallback to our default behavior (i.e. invoke our builtin handler after all) 
  const invokeHandler = (handlerName, oform, env, theInterpreter) => {
    let handlerResult = env[handlerName](oform, env, theInterpreter)

    if (handlerResult === undefined && env[handlerName] !== builtins.handlers[handlerName]) {
      handlerResult = builtins.handlers[handlerName](oform, env, theInterpreter)
    }

    return handlerResult
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

      // their $fn symbol key did not resolve in the environment
      return invokeHandler('onNotFound', oform, env, theInterpreter)
    }

    // no $fn symbol key found on the object
    // "onPlainJson" is an optional handler client code can use to intercept and process such non-jexi json:
    return invokeHandler('onPlainJson', oform, env, theInterpreter)
  }

  return theInterpreter
}

export default jexiInterpreter
