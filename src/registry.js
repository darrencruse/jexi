/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle */
import set from 'lodash.set'

// the registry maps the built-in "$symbols" to javascript functions/values.
// the application adds to these using the interpreter "registry" option
export default {
  // built-in "$functions" provided by the interpreter
  // where { $fn: [ arg1, ..., argN ] } means to call $fn(arg1, ..., argN)
  // note: unlike special forms these have their arguments evaluated *before* they are called
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

    // $for/in/do = for each array element do a lamdba
    // e.g.: { $for: { in: [ 0, 1, 2 ], do: { '$=>': { args: [ '$elem' ], do: { '$console.log': '$elem' }}}}}
    'for': ({ in: array, do: fn }) => {
      // SHOULDNT THIS BE DOING FOR AWAIT? 
      array.forEach(fn)
    },

    // $map/in/by = map array data using a function
    // e.g. { $map: { in: [ 0, 1, 2 ], by: { '$=>': { args: [ '$elem' ], do: { '$*': [ '$elem', 2 ]}}}}}
    'map': async ({ in: array, by: fn }) => {
      const mapPromises = array.map(fn)

      // await promises for the results (if promises came back)
      const resolved = Array.isArray(mapPromises) && mapPromises.length > 0 && mapPromises[0].then ?
        await Promise.all(mapPromises) : mapPromises

      return resolved
    },

    // $do = do a sequence of operations in an array and return the value of the last one
    'do': (...evaledForms) => evaledForms.length > 0 ? evaledForms[evaledForms.length - 1] : evaledForms,
  },

  // built-in "handlers" provided by the interpreter
  // in jexi "handlers" differ from "functions" (see above) in how they are called
  // for "functions" { $fn: [ arg1, ..., argN ] } means to call $fn(arg1, ..., argN)
  // for "handlers" { $fn: [ arg1, ..., argN ] } means to call $fn([ arg1, ..., argN ], variables, jexi) so that:
  // a.  no argument spreading occurs (e.g. the first argument to $fn is always just an array of the args)
  // b.  access is provided to the variables context thru the variables argument
  // c.  the interpreter can be re-entered using jexi.evaluate when necessary
  // d.  tracing can be done using jexi.trace
  // etc.
  // note: unlike special forms handlers have their arguments evaluated *before* they are called
  handlers: {
    // $filter/in/where = filter array data using a predicate
    // e.g. { $filter: { in: [ -1, 0, 1 ], where: { '$=>': { args: [ '$elem' ], do: { '$>': [ '$elem', 0 ]}}}}}
    'filter': async ([{ in: array, where: fn }], variables, { evaluate }) => {
      const inOrOut = await evaluate({ $map: { in: array, by: fn }}, variables)

      return array.filter((_elem, i) => inOrOut[i])
    },
  },

  // special forms are like normal functions but "special" in that
  // they don't have their arguments evaluated before they are called
  // most special forms define control structures or perform variable bindings
  specialForms: {
    // $let/var/in = defines a scope with one or more local variables
    // example: { $let: { var: {'$x': 1, '$y': 2}, in: [body uses $x and $y] }}
    'let': async (varsInObj, variables, { evaluate, symbolToString, trace }) => {
      trace('in let:', varsInObj)

      const { var: declarationsObj, in: body } = varsInObj
      const letScope = Object.create(variables)

      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
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

    // $=>/args/do = lamdba/anonymous function
    // { $=>: { args: [ $arg1, ..., $argN], do: [ function body ] } }
    '=>': (argsDoObj, declareContext, { evaluate, globals, symbolToString, trace }) => {
      trace('declaring the lambda:', argsDoObj)

      const { args: argNames, do: body } = argsDoObj

      // return a function called later when the $fn is actually called  
      const lambda = async (invokedArgs, variables, jexi) => {
        trace('handling lambda called with:', invokedArgs)

        // put the values passed for the arguments into a local scope
        // note: if called from javascript using the global vars is better than no vars at all
        //   (e.g. $for does a simple array.forEach which calls this lamdba function directly)
        const localContext = Object.create(jexi?.evaluate ? variables : globals)

        if (Array.isArray(invokedArgs) && argNames) {
          argNames.forEach((argsymbol, i) => {
            const argname = symbolToString(argsymbol)

            trace('setting arg in local scope:', argname, invokedArgs[i])
            localContext[argname] = invokedArgs[i]
          })
        } else if (argNames) {
          const argname = symbolToString(argNames[0] || argNames)

          trace('setting arg in local scope:', argname, invokedArgs)
          localContext[argname] = invokedArgs
        }

        // evaluate the body of the function with it's args in scope:
        trace('evaluating body of lambda:', body)
        const result = await evaluate(body, localContext)

        trace('got from evaluating body of lambda:', body, ' LOOK:', result)

        return result
      }

      lambda._handler = true

      return lambda
    },

    // $function/name/args/do = a named function
    // { $function: { name: fnname, args: [ '$arg1', ..., '$argN'], do: [ function body ] }}
    // e.g. { $function: { name: '$print', args: [ '$msg' ], do: { $console.log: $msg }}}
    'function': ({ name, args, do: body }, variables, { evaluate }) =>
      evaluate({ $var: { [name]: { '$=>': { args, do: body }}}}, variables),

    // $if/cond/then/else is a special form because it only evaluates one of the if/else clauses
    // or { $if: { cond: { '$>': [ '$x', 0 ] }, then: 'some', else: 'none' } }
    'if': async ({ cond, then, else: otherwise }, variables, { evaluate }) =>
      await evaluate(cond, variables) ?
        evaluate(then, variables) :
        evaluate(otherwise, variables),

    // eslint-disable-next-line no-console
    'globals': (_args, _variables, { globals }) => console.log(globals),

    // eslint-disable-next-line no-console
    'variables': (_args, variables) => console.log(variables),

    // this is really just a start at a way to exit evaluating early
    // (I was thinking/hoping evaluate can check this but it doesn't yet)
    'exit': (_args, _variables, trace, { globals }) => {
      trace('Setting global _exit flag to abort the evaluation')

      globals._exit = true
    },
  },

  // global values (not functions or special forms just values)
  globals: {
    console,
  },
}
