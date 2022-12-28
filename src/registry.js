/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle */
import castArray from 'lodash.castarray'
import set from 'lodash.set'

// spread the sform/oform (array) arguments as the (normal) arguments of cb
// used like e.g.:  sargs('+', (lhs, rhs) => lhs + rhs), 
const sargs = (fname, cb) =>
  (form, _variables, _trace, { stringToSymbol }) =>
    cb(...Array.isArray(form) ?
      form.slice(1) :
      castArray(form[stringToSymbol(fname)]))

// the registry maps the built-in "$symbols" to javascript functions/values.
// the application adds to these using the interpreter "registry" option
export default {
  // special forms are like normal functions but "special" in that
  // they don't have their arguments evaluated before they are called
  // most special forms define control structures or perform variable bindings
  specialForms: {
    // $let defines a scope with one or more local variables
    // define one: ["$let", ["$x", 1], [body uses "$x" ]]
    // define multiple: ["$let", [["$x", 1], ["$y", 2]], [body uses "$x" and "$y"]]
    'let': async (form, variables, trace, { evaluate, symbolToString }) => {
      trace('in let:', form)
      const letScope = Object.create(variables)
      // it's annoying when only defining one var to have to do wrap the var defs:
      // e.g. ['$let', [['$x', 'hello world']], '$x'] - so wrap it for them
      const varDefs = form[1].length > 0 && Array.isArray(form[1][0]) ? form[1] : [ form[1] ]

      for (const [ symbol, value ] of varDefs) {
        try {
          const name = symbolToString(symbol)

          trace('setting', name, 'to:', value)
          // eslint-disable-next-line no-await-in-loop
          letScope[name] = await evaluate(value, variables)
          trace('read back:', letScope[name])
        } catch (err) {
          // TBD better error handling
          console.error('In $let exception:', err, 'evaluating:', JSON.stringify(value, null, 2))
        }
      }

      return evaluate(form[2], letScope)
    },

    // $var defines a variable in the current scope
    // e.g. ["$var", "$x", 1] or { "$var": [ "$x": 1 ]}
    // note: "$x" is saved as simply "x" in the variables
    'var': async (form, variables, trace, { evaluate, symbolToString }) => {
      const symbol = Array.isArray(form) ? form[1] : form.$var[0]
      const name = symbolToString(symbol)
      const value = Array.isArray(form) ? form[2] : form.$var[1]

      trace(`setting ${name} to ${value}`)
      variables[name] = await evaluate(value, variables)

      // we intentionally evaluate to undefined here
      // because $var defining a function was getting called
      // at the declaration
      return undefined
    },

    // $set assigns a value at a specified path in variables
    // e.g. ["$set", "$x", 1] or { "$set": [ "$x.y": "$y" ]}
    // note: "$x" is set as simply "x" in the variables
    'set': async (form, variables, trace, { evaluate, symbolToString }) => {
      const pathSymbol = Array.isArray(form) ? form[1] : form.$set[0]
      const path = symbolToString(pathSymbol)
      const value = Array.isArray(form) ? form[2] : form.$set[1]

      trace(`setting ${path} to ${value}`)
      set(variables, path, await evaluate(value, variables))

      // we intentionally evaluate to undefined here
      return undefined
    },

    // $=> = anonymous function
    // ["$=>", [ "$arg1", ..., "$argN"], [ function body ]]
    '=>': (declareForm, declareContext, trace, { evaluate, globals, symbolToString }) => {
      trace('declaring the lambda:', declareForm)

      // return a function called later when the $fn is actually called  
      const lambda = async (...args) => {
        // infer if we were called by the interpreter or by plain javascript:
        const interpreterCall = args.length === 4 && args[3].evaluate
        // slice below because the function starts the array form
        const callArgs = interpreterCall ? args[0].slice(1) : args
        const callContext = interpreterCall ? args[1] : globals

        trace('handling lambda called with:', callArgs)
        // put the values passed for the arguments into a local scope
        const localContext = Object.create(callContext)

        declareForm[1].forEach((argsymbol, i) => {
          const argname = symbolToString(argsymbol)

          trace('setting arg in local scope:', argname, callArgs[i])
          localContext[argname] = callArgs[i]
        })

        // evaluate the body of the function with it's args in scope:
        trace('evaluating body of lambda:', declareForm[2])
        const result = await evaluate(declareForm[2], localContext)

        trace('got from evaluating body of lambda:', declareForm[2], ' LOOK:', result)

        return result
      }

      lambda._formhandler = true

      return lambda
    },

    // $function = a named function
    // ["$function", "$name", [ "$arg1", ..., "$argN"], [ function body ]]
    'function': (form, variables, _trace, { evaluate }) =>
      evaluate([ '$var', form[1], [ '$=>', form[2], form[3] ]], variables),

    // $if is a special form because it only evaluates one of the if/else clauses
    // e.g. ["$if", ["$>", "$x", 0], "some", "none"]
    // or { "$if" : ["$>", "$x", 0], "then": "some", "else": "none"}
    'if': async (form, variables, _trace, { evaluate, getArg }) =>
      await evaluate(getArg(form, '$if', 1), variables) ?
        evaluate(getArg(form, 'then', 2), variables) :
        evaluate(getArg(form, 'else', 3), variables),

    // eslint-disable-next-line no-console
    'globals': (_form, _variables, trace, { globals }) => console.log(globals),

    // this is really just a start at a way to exit evaluating early
    // atm I've only honored this on place (I was thinking/hoping evaluate can check this)
    'exit': (_form, variables, trace, { globals }) => {
      trace('Setting global _exit flag to abort the evaluation')

      globals._exit = true
    },
  },

  // the built-in "$functions" provided by the interpreter
  // unlike special forms these have their arguments evaluated before they are called
  functions: {
    'do': sargs('$do', (...evaledForms) => evaledForms.length > 0 ? evaledForms[evaledForms.length - 1] : evaledForms),
    '!': sargs('!', operand => !operand),
    '&&': sargs('&&', (lhs, rhs) => lhs && rhs),
    '||': sargs('||', (lhs, rhs) => lhs || rhs),
    '+': sargs('+', (lhs, rhs) => lhs + rhs),
    '-': sargs('-', (lhs, rhs) => lhs - rhs),
    '*': sargs('*', (lhs, rhs) => lhs * rhs),
    '/': sargs('/', (lhs, rhs) => lhs / rhs),
    '%': sargs('%', (lhs, rhs) => lhs % rhs),
    // eslint-disable-next-line eqeqeq
    '==': sargs('==', (lhs, rhs) => lhs == rhs),
    // eslint-disable-next-line eqeqeq
    '!=': sargs('!=', (lhs, rhs) => lhs != rhs),
    '===': sargs('===', (lhs, rhs) => lhs === rhs),
    '!==': sargs('!==', (lhs, rhs) => lhs !== rhs),
    '>': sargs('>', (lhs, rhs) => lhs > rhs),
    '>=': sargs('>=', (lhs, rhs) => lhs >= rhs),
    '<': sargs('<', (lhs, rhs) => lhs < rhs),
    '<=': sargs('<=', (lhs, rhs) => lhs <= rhs),

    // $for each array element
    // e.g. ["$for", [0, 1, 2], ["$=>", ["$elem"], ["$console.log", "$elem"]]]
    // or {"$for" : [0, 1, 2], "each": ["$=>", ["$elem"], ["$console.log", "$elem"]]}
    'for': (form, _variables, _trace, { getArg }) => {
      const data = getArg(form, '$for', 1)
      const fn = getArg(form, 'each', 2)

      data.forEach(fn)
    },

    // $map array data using a function
    // e.g. ["$map", [0, 1, 2], ["$=>", ["$elem"], ["$*", "$elem", 2]]]
    // or {"$map" : [0, 1, 2], "transform": ["$=>", ["$elem"], ["$*", "$elem", 2]]}
    'map': async (form, _variables, _trace, { getArg }) => {
      const data = getArg(form, '$map', 1)
      const fn = getArg(form, 'transform', 2)

      const mapPromises = data.map(fn)

      const resolved = Array.isArray(mapPromises) && mapPromises.length > 0 && mapPromises[0].then ?
        await Promise.all(mapPromises) : mapPromises

      return resolved
    },

    // filter array data using a predicate
    // e.g. ["$filter", [-1, 0, 1], ["$=>", ["$elem"], ["$>", "$elem", 0]]]
    // or {"$$filter" : [-1, 0, 1], "where": ["$=>", ["$elem"], ["$>", "$elem", 0]]}
    'filter': async (form, variables, _trace, { evaluate, getArg }) => {
      const data = getArg(form, '$filter', 1)
      const predicate = getArg(form, 'where', 2)

      const inOrOut = await evaluate([ '$map', data, predicate ], variables)

      return data.filter((_elem, i) => inOrOut[i])
    },
  },

  // global values (not functions or special forms just values)
  globals: {
    console,
  },
}
