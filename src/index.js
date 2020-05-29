/* eslint-disable no-extra-parens */

// the registry maps "$symbols" to javascript functions/values.
// special forms are also functions but "special" in that
// they don't have their arguments evaluated before they are called 
// the "base" ones below are the generic built-in ones - the application
// extends these provided ones via the interpreter "registry" and
// "specialForms" options
import baseRegistry from './registry.js'
import baseSpecials from './specialForms.js'

const interpreter = (options = {}) => {
  //options.trace = true

  // eslint-disable-next-line no-console
  const trace = (...args) => options.trace && console.log.apply(null, args)

  // our "symbols" in JSON strings marked with a prefix "$"
  // but being sure to ignore money e.g. "$1.50" or syntax that may
  // arise when embedding *other* expression languages e.g.
  // jsonpath ("$.prop"), jsonata ("$max(array)") etc.
  const symbolDetector = options.symbolDetector || '^\\$[^$0-9][^(){}]*$'
  const symRegex = new RegExp(symbolDetector)
  const isSymbol = atom => typeof atom === 'string' && symRegex.test(atom)

  // converting symbol to string just removes the $ prefix
  const symbolToString = symbolStr => symbolStr.substring(1)

  const specialForms = { ...baseSpecials, ...(options.specialForms || {}) }

  trace('specialForms=', specialForms)

  const registry = { ...baseRegistry, ...(options.registry || {}) }

  trace('registry=', registry)

  const interpret = (form, context = {}) => {
    trace('interpret: evaluating:', JSON.stringify(form, null, 2))
    if (Array.isArray(form)) {
      // eslint-disable-next-line no-use-before-define
      return interpretArrayForm(form, context)
    } else if (typeof form === 'object') {
      // eslint-disable-next-line no-use-before-define
      return interpretObjectForm(form, context)
    } else if (isSymbol(form)) {
      trace(`interpret: replacing "${form}"/"${symbolToString(form)}" value from context or registry`)

      // change to do these lookup using lodash get?
      // like what about reaching into nested objects in the assembly state?
      return context[form] || context[symbolToString(form)] || registry[form]
    }

    trace(`interpret: passing ${form} thru as plain data`)

    return form
  }

  // the array form is really the classic lispy s-expression form
  const interpretArrayForm = (sform, context) => {
    // special forms are called with their args unevaluated:
    if (sform.length > 0 && specialForms[sform[0]]) {
      return specialForms[sform[0]](sform, context, trace, interpret)
    }

    // regular forms have their args evaluated before they are called
    const possibleSym = sform[0]
    const evaluated = sform.map(atom => interpret(atom, context))

    trace('sform: evaluated before call:', JSON.stringify(evaluated, null, 2), evaluated[0], typeof evaluated[0])
    if (typeof evaluated[0] === 'function') {
      trace(`sform: calling ${possibleSym}`)

      return evaluated[0].call(undefined, evaluated, context, trace, interpret)
    }

    trace(`sform: ${possibleSym} not a function passing thru as evaluated data`)
    if (isSymbol(possibleSym) && typeof evaluated[0] === 'undefined') {
      // this was an unrecognized symbol pass it thru unchanged
      evaluated[0] = possibleSym
    }

    return evaluated
  }

  // the object form is using json object keys like named arguments
  const interpretObjectForm = (oform, context) => {
    // special forms are called with their args unevaluated:
    const keys = Object.keys(oform) || []
    const symbol = keys.find(isSymbol)

    if (symbol) {
      if (specialForms[symbol]) {
        return specialForms[symbol](oform, context, trace, interpret)
      } else if (typeof registry[symbol] === 'function') {
        // regular sforms have their args evaluated before they are called
        // the equivalent here is the values of all keys are evaluated before the fn is called
        keys.forEach(key => {
          oform[key] = interpret(oform[key], context)
        })

        trace(`oform: calling ${symbol}`)

        return registry[symbol].call(undefined, oform, context, trace, interpret)
      }

      trace(`passing thru object with unrecognized symbol key "${symbol}"`)
    }

    trace('oform: evaluting key values of plain of object as a template')
    keys.forEach(key => {
      oform[key] = interpret(oform[key], context)
    })

    return oform
  }

  return {
    isSymbol,
    interpret,
    eval: interpret,
  }
}

export default {
  interpreter,
}
