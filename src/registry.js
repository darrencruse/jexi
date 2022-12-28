/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle */
import set from 'lodash.set'

// the registry maps the built-in "$symbols" to javascript functions/values.
// the application adds to these using the interpreter "registry" option
export default {
  // special forms are like normal functions but "special" in that
  // they don't have their arguments evaluated before they are called
  // most special forms define control structures or perform variable bindings
  specialForms: {
    // $let defines a scope with one or more local variables
    // define one: { $let: { vars: ['$x', 1] in: [body uses $x ] }}
    // define multiple: { $let: { vars: [['$x', 1], ['$y', 2]], in: [body uses $x and $y] }}
    'let': async (form, variables, { evaluate, symbolToString, trace }) => {
      trace('in let:', form)

      const { vars, in: body } = form
      const letScope = Object.create(variables)
      // it's annoying when only defining one var to have to wrap the var defs in a double array:
      const varDefs = vars.length > 0 && Array.isArray(vars[0]) ? vars : [ vars ]

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

      return evaluate(body, letScope)
    },

    // $var defines a variable in the current scope
    // e.g. { $var: { $x: 1, $y: 2 } }
    // note: "$x" is saved as simply "x" in the variables
    'var': async (declarationsObj, variables, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const name = symbolToString(symbol)

        trace(`setting ${name} to ${value}`)
        variables[name] = await evaluate(value, variables)
      }

      // we intentionally evaluate to undefined here
      // because $var defining a function was getting called
      // at the declaration
      return undefined
    },

    // $set assigns a value at a specified path in variables
    // e.g. { $set: { $x: { y: 1 }, $x.z: 2 } }
    // note: "$x" is stored as simply "x" in the variables
    'set': async (declarationsObj, variables, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const path = symbolToString(symbol)

        trace(`setting ${path} to ${value}`)
        set(variables, path, await evaluate(value, variables))
      }

      // we intentionally evaluate to undefined here
      return undefined
    },

    // $=> = lamdba/anonymous function
    // { $=>: { args: [ $arg1, ..., $argN], do: [ function body ] } }
    '=>': (form, declareContext, { evaluate, globals, symbolToString, trace }) => {
      trace('declaring the lambda:', form)

      const { args: argNames, do: body } = form

      // return a function called later when the $fn is actually called  
      const lambda = async (...invokeArgs) => {
        // infer if we were called by the interpreter or by plain javascript:
        const interpreterCall = invokeArgs.length === 3 && invokeArgs[2].evaluate
        // if called from javascript using the global vars is better than no vars at all:
        const callContext = interpreterCall ? invokeArgs[1] : globals

        trace('handling lambda called with:', invokeArgs)
        // put the values passed for the arguments into a local scope
        const localContext = Object.create(callContext)

        argNames.forEach((argsymbol, i) => {
          const argname = symbolToString(argsymbol)

          trace('setting arg in local scope:', argname, invokeArgs[i])
          localContext[argname] = invokeArgs[i]
        })

        // evaluate the body of the function with it's args in scope:
        trace('evaluating body of lambda:', body)
        const result = await evaluate(body, localContext)

        trace('got from evaluating body of lambda:', body, ' LOOK:', result)

        return result
      }

      lambda._formhandler = true

      return lambda
    },

    // $function = a named function
    // { $function: { name: fnname, args: [ '$arg1', ..., '$argN'], do: [ function body ] }}
    // e.g. { $function: { name: '$print', args: [ '$msg' ], do: { $console.log: $msg }}}
    'function': ({ name, args, do: body }, variables, { evaluate }) =>
      evaluate({ $var: { [name]: { '$=>': { args, do: body }}}}, variables),

    // $if is a special form because it only evaluates one of the if/else clauses
    // or { $if: { cond: { '$>': [ '$x', 0 ] }, then: 'some', else: 'none' } }
    'if': async ({ cond, then, else: otherwise }, variables, { evaluate }) =>
      await evaluate(cond, variables) ?
        evaluate(then, variables) :
        evaluate(otherwise, variables),

    // eslint-disable-next-line no-console
    'globals': (_form, _variables, { globals }) => console.log(globals),

    // eslint-disable-next-line no-console
    'variables': (_form, variables) => console.log(variables),

    // this is really just a start at a way to exit evaluating early
    // atm I've only honored this one place (I was thinking/hoping evaluate can check this)
    'exit': (_form, variables, trace, { globals }) => {
      trace('Setting global _exit flag to abort the evaluation')

      globals._exit = true
    },
  },

  // the built-in "$functions" provided by the interpreter
  // unlike special forms these have their arguments evaluated before they are called
  functions: {
    '!': operand => !operand,
    '&&': (lhs, rhs) => lhs && rhs,
    '||': (lhs, rhs) => lhs || rhs,
    '+': (lhs, rhs) => lhs + rhs,
    '-': (lhs, rhs) => lhs - rhs,
    '*': (lhs, rhs) => lhs * rhs,
    '/': (lhs, rhs) => lhs / rhs,
    '%': (lhs, rhs) => lhs % rhs,
    // eslint-disable-next-line eqeqeq
    '==': (lhs, rhs) => lhs == rhs,
    // eslint-disable-next-line eqeqeq
    '!=': (lhs, rhs) => lhs != rhs,
    '===': (lhs, rhs) => lhs === rhs,
    '!==': (lhs, rhs) => lhs !== rhs,
    '>': (lhs, rhs) => lhs > rhs,
    '>=': (lhs, rhs) => lhs >= rhs,
    '<': (lhs, rhs) => lhs < rhs,
    '<=': (lhs, rhs) => lhs <= rhs,

    // $for array element
    // e.g.: { $for: { in: [ 0, 1, 2 ], do: { '$=>': [[ '$elem' ], { '$console.log': '$elem' }]}}}
    'for': ({ in: array, do: fn }) => {
      // SHOULDNT THIS BE DOING FOR AWAIT? 
      array.forEach(fn)
    },

    // $map array data using a function
    // or { $map: { in: [ 0, 1, 2 ], do: { '$=>': [[ '$elem' ], { '$*': [ '$elem', 2 ]}]}}}
    'map': async ({ in: array, do: fn }) => {
      const mapPromises = array.map(fn)

      // await promises for the results (if promises came back)
      const resolved = Array.isArray(mapPromises) && mapPromises.length > 0 && mapPromises[0].then ?
        await Promise.all(mapPromises) : mapPromises

      return resolved
    },

    // filter array data using a predicate
    // or { $filter: { in: [ -1, 0, 1 ], where: { '$=>': [[ '$elem' ], { '$>': [ '$elem', 0 ]}]}}}
    'filter': async ({ in: array, where: fn }, variables, jexi) => {
      const inOrOut = await jexi.evaluate({ $map: { in: array, do: fn }}, variables)

      return array.filter((_elem, i) => inOrOut[i])
    },

    // note variables and the jexi interpreter are always passed hence length > 2
    'do': (...evaledForms) => evaledForms.length > 2 ? evaledForms[evaledForms.length - 3] : evaledForms,
  },

  // global values (not functions or special forms just values)
  globals: {
    console,
  },
}
