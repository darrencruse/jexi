/* eslint-disable no-extra-parens, no-underscore-dangle */
import builtins from './registry.js'
import get from 'lodash.get'
import repl from 'repl'

const getRegistrySpecialForms = registry => {
  if (!registry || !registry.specialForms) {
    return {}
  }

  // the "specialForms" section of the registry is just a convenience
  // (they wind up in global scope with the other functions but marked _special)
  Object.keys(registry.specialForms).forEach(key => {
    registry.specialForms[key]._special = true
  })

  return registry.specialForms
}

const getRegistryFunctions = registry => registry && registry.functions || {}

export const interpreter = (options = {}) => {
  //options.trace = true

  // eslint-disable-next-line no-console
  const trace = (...args) => options.trace && console.log.apply(null, args)

  // our "symbols" in JSON strings marked with a prefix "$"
  // but being sure to ignore money e.g. "$1.50" or syntax that may
  // arise when embedding *other* expression languages e.g.
  // jsonpath ("$.prop"), jsonata ("$max(array)") etc.
  const symRegex = new RegExp('^\\$[^$0-9][^(){}]*$')
  const isSymbol = atom => typeof atom === 'string' && symRegex.test(atom)

  // converting symbol to string just removes the $ prefix
  const symbolToString = symbolStr => symbolStr.substring(1)

  // converting string to symbol just adds the $ prefix
  const stringToSymbol = str => `${str.trim()}`

  // return the "$function" symbol specified in the provided (array or object) form
  // (otherwise null if there isn't one)
  const getFnSymbolForForm = form => {
    let fnSymbol = null

    if (Array.isArray(form)) {
      fnSymbol = form.length > 0 && isSymbol(form[0]) && form[0]
    } else {
      const keys = Object.keys(form) || []
      const symbols = keys.filter(isSymbol)

      if (symbols.length > 0) {
        fnSymbol = symbols[0]

        if (symbols.length > 1) {
          console.warn(`Warning: ambiguous object form with multiple "$function" keys (using ${fnSymbol}):`)
        }
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

  const globals = {
    ...getRegistrySpecialForms(builtins),
    ...getRegistrySpecialForms(options.registry),
    ...getRegistryFunctions(builtins),
    ...getRegistryFunctions(options.registry),
  }

  trace('interpreter globals=', globals)

  const evaluate = async (form, variables = globals, options = {}) => {
    trace('evaluate: evaluating:', JSON.stringify(form, null, 2))
    //trace('evaluate: evaluating with vars of:', JSON.stringify(variables, null, 2))
    let result = form

    if (Array.isArray(form)) {
      // eslint-disable-next-line no-use-before-define
      result = await evaluateArrayForm(form, variables, options)
    } else if (typeof form === 'object') {
      // eslint-disable-next-line no-use-before-define
      result = await evaluateObjectForm(form, variables, options)
    } else if (isSymbol(form)) {
      trace(`evaluate: replacing "${form}"/"${symbolToString(form)}" value from variables`)

      // note that we've made including the "$" prefix on the *actual* variable names
      // optional (this might change TBD)
      result = get(variables, form) || get(variables, symbolToString(form))
    } else {
      trace(`evaluate: passing ${form} thru as plain data`)
    }

    trace(`evaluate: returning ${JSON.stringify(result, null, 2)} for ${JSON.stringify(form, null, 2)}`)

    return result
  }

  const startRepl = (options = {}) => {
    // TBD SHOULD I BE USING THEIR PROVIDED CONTEXT OR WIRING IT TO OURS SOMEHOW?
    const replEval = async (cmd, _context, _filename, callback) => {
      let form = null
      let result = null

      try {
        form = JSON.parse(cmd)
      } catch (err) {
        result = 'Invalid JSON please correct.'
      }

      if (form) {
        result = await evaluate(form)
      }

      callback(null, result)
    }

    repl.start({ prompt: `${options.prompt || '>'} `, eval: replEval })
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
  }

  // the array form is really the classic lispy s-expression form
  const evaluateArrayForm = async (sform, variables, options = {}) => {
    const $fnSymbol = getFnSymbolForForm(sform)

    // special forms are called with their args unevaluated:
    if ($fnSymbol && variables[$fnSymbol] && variables[$fnSymbol]._special) {
      return variables[$fnSymbol](sform, variables, trace, theInterpreter)
    }

    // regular forms have their args evaluated before they are called
    // note: we also wait here for promises (if any) to settle before making the call
    let evaluated = []

    if (options.parallel) {
      const promises = sform.map(atom => evaluate(atom, variables))

      evaluated = await Promise.all(promises)
    } else {
      // normally we wait for each step to complete
      // (later functions might depend on the output of earlier ones)
      evaluated = await mapAndWait(sform, atom => evaluate(atom, variables))
    }


    trace('evaluateArrayForm: evaluated before call:', JSON.stringify(evaluated, null, 2), evaluated[0], typeof evaluated[0])
    if (typeof evaluated[0] === 'function') {
      trace(`evaluateArrayForm: calling ${$fnSymbol}`)

      return evaluated[0].call(undefined, evaluated, variables, trace, theInterpreter)
    }

    trace(`evaluateArrayForm: ${$fnSymbol} not a function passing thru as evaluated data`)
    if ($fnSymbol && typeof evaluated[0] === 'undefined') {
      // this was an unrecognized symbol pass it thru unchanged
      evaluated[0] = $fnSymbol
    }

    return evaluated
  }

  // the object form is using json object keys like named arguments
  // eslint-disable-next-line no-unused-vars
  const evaluateObjectForm = async (oform, variables, options = {}) => {
    // special forms are called with their args unevaluated:
    const keys = Object.keys(oform) || []
    const $fnSymbol = getFnSymbolForForm(oform)

    if ($fnSymbol) {
      if (variables[$fnSymbol] && variables[$fnSymbol]._special) {
        return variables[$fnSymbol](oform, variables, trace, theInterpreter)
      } else if (typeof variables[$fnSymbol] === 'function') {
        // regular sforms have their args evaluated before they are called
        // the equivalent here is the values of all keys are evaluated before the fn is called
        // note: we also wait here for promises (if any) to settle before making the call
        await mapAndWait(keys, async key => {
          const evaluated = await evaluate(oform[key], variables)

          oform[key] = evaluated
        })

        trace(`evaluateObjectForm: calling ${$fnSymbol}`)

        return variables[$fnSymbol].call(undefined, oform, variables, trace, theInterpreter)
      }

      trace(`evaluateObjectForm: passing thru object with unrecognized symbol key "${$fnSymbol}":`, JSON.stringify(oform, null, 2))
    }

    trace('evaluateObjectForm: evaluting key values of plain object as a template')

    // note: we also wait here for promises (if any) to settle
    await mapAndWait(keys, async key => {
      const evaluated = await evaluate(oform[key], variables)

      oform[key] = evaluated
    })

    return oform
  }

  return theInterpreter
}

export default interpreter
