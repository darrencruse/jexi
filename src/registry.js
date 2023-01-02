/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle */
import { JSONPath } from 'jsonpath-plus'
import jsonata from 'jsonata'
import set from 'lodash.set'

const compiledJsonataMap = new Map()

const jsonataPromise = (expr, data, bindings) => new Promise((resolve, reject) => {
  expr.evaluate(data, bindings, (error, response) => {
    if (error) {
      reject(error)
    }
    resolve(response)
  })
})

// the registry maps the built-in "$symbols" to javascript functions/values.
// the application adds to by passing similar to the below as "extensions"
// to the interpreter() create function
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
    // note really-relaxed-json doesn't like $* it needs it quoted as '$*'
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

    // $do = do a sequence of operations in an array and return the value of the last one
    'do': (...evaledForms) => evaledForms.length > 0 ? evaledForms[evaledForms.length - 1] : evaledForms,
  },

  // built-in "handlers" provided by the interpreter
  // in jexi "handlers" differ from "functions" (see above) in how they are called
  // for "functions" { $fn: [ arg1, ..., argN ] } means to call $fn(arg1, ..., argN)
  // for "handlers" { $fn: [ arg1, ..., argN ] } means to call $fn([ arg1, ..., argN ], env, jexi) so that:
  // a.  no argument spreading occurs (e.g. the first argument to $fn is always just an array of the args)
  // b.  access is provided to the variables context thru the env argument
  // c.  the interpreter can be re-entered using jexi.evaluate when necessary
  // d.  tracing can be done using jexi.trace
  // etc.
  // note: unlike special forms handlers have their arguments evaluated *before* they are called
  handlers: {
    // $for/in/do = for each array element do a lamdba
    // e.g.: { $for: { in: [ 0, 1, 2 ], do: { '$=>': { args: [ '$elem' ], do: { '$console.log': '$elem' }}}}}
    'for': async ([{ in: array, do: fn }], env, jexi) => {
      for await (const elem of array) {
        fn([ elem ], env, jexi)
      }
    },

    // $map/in/by = map array data using a function
    // e.g. { $map: { in: [ 0, 1, 2 ], by: { '$=>': { args: [ '$elem' ], do: { '$+': [ '$elem', 1 ]}}}}}
    'map': async ([{ in: array, by: fn }], env, jexi) => {
      const mapPromises = array.map(elem => fn([ elem ], env, jexi))

      // await promises for the results (if promises came back)
      const resolved = Array.isArray(mapPromises) && mapPromises.length > 0 && mapPromises[0].then ?
        await Promise.all(mapPromises) : mapPromises

      return resolved
    },

    // $filter/in/where = filter array data using a predicate
    // e.g. { $filter: { in: [ -1, 0, 1 ], where: { '$=>': { args: [ '$elem' ], do: { '$>': [ '$elem', 0 ]}}}}}
    'filter': async ([{ in: array, where: fn }], env, { evaluate }) => {
      const inOrOut = await evaluate({ $map: { in: array, by: fn }}, env)

      return array.filter((_elem, i) => inOrOut[i])
    },

    // $jsonpath/path/in = return jsonpath matches within the specified json
    // (otherwise within the entire environment if 'path/in' is omitted)
    // e.g. from json: { $jsonpath: { path: '$.store.book[*].author', in: { store: { book: [ { author: 'Tolkien' }]}}}}
    // or from a var: e.g. { $jsonpath: { path: '$.store.book[*].author', in: $bookStore }}
    // or directly in the environment: { $jsonpath: '$.bookStore.store.book[*].author' }
    'jsonpath': ([ arg ], env) => {
      const path = typeof arg === 'string' ? arg : arg.path
      const json = arg.in || env

      return JSONPath({ path, json })
    },

    // $jsonpath/path/in = return jsonpath matches within the specified json
    // (otherwise within the entire environment if 'in' is omitted)
    // e.g. { $jsonpath: { path: '$.store.book[*].author', in: { store: { book: [ { author: 'Tolkien' }]}}}}
    // or from the env e.g. { $jsonpath: { path: '$.store.book[*].author', in: $payloads.bookStore }}
    'jsonata': async ([ arg ], env) => {
      const expression = typeof arg === 'string' ? arg : arg.expr
      const json = arg.in || env
      let compiled = compiledJsonataMap.get(expression)

      if (!compiled) {
        compiled = jsonata(expression)

        compiledJsonataMap.set(expression, compiled)
      }

      try {
        // evaluate the jsonata without cloning
        const result = await jsonataPromise(compiled, json, { clone: arg => arg })

        // jsonata adds a "sequence" flag on arrays that we don't want:
        if (Array.isArray(result) && typeof result.sequence !== 'undefined') {
          delete result.sequence
        }

        return result
      } catch (e) {
        throw new Error(`Failed to execute jsonata expression. ${e.message} Expression: ${expression}`)
      }
    },
  },

  // special forms are like normal functions but "special" in that
  // they don't have their arguments evaluated before they are called
  // most special forms define control structures or perform variable bindings
  specialForms: {
    // $quote = return the quoted form as plain json unevaluated
    // e.g.  { $quote: '$.store.book[*].author' }
    // IS THIS SUFFICIENT FOR QUOTE?  READ UP ABOUT QUOTE/QUASIQUOTE EG IN THE MAL TUTORIAL?
    'quote': unevaluatedForm => unevaluatedForm,

    // $new = constructs an instance using javascript "new"
    // example: { $new: { $Date: [ 'December 17, 1995 03:24:00' ] } }
    'new': async (classAndArgs, env, { evaluate, trace }) => {
      trace('in new:', classAndArgs)

      const [ classSymbol, constructorArgs ] = Object.entries(classAndArgs)[0]

      // lookup the actual javscript class using $class
      const theClass = await evaluate(classSymbol, env)

      return new theClass(...constructorArgs)
    },

    // $let/var/in = defines a scope with one or more local variables
    // example: { $let: { var: {'$x': 1, '$y': 2}, in: [body uses $x and $y] }}
    'let': async (varsInObj, env, { evaluate, symbolToString, trace }) => {
      trace('in let:', varsInObj)

      const { var: declarationsObj, in: body } = varsInObj
      const letScope = Object.create(env)

      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        try {
          const name = symbolToString(symbol)

          trace('setting', name, 'to:', value)
          // eslint-disable-next-line no-await-in-loop
          letScope[name] = await evaluate(value, env)
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
    // note: "$x" is saved as simply "x" in the environment
    'var': async (declarationsObj, env, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const name = symbolToString(symbol)

        trace(`setting ${name} to ${value}`)
        env[name] = await evaluate(value, env)
      }

      // we intentionally evaluate to undefined here
      // because $var defining a function was getting called
      // at the declaration
      return undefined
    },

    // $set assigns a value at a specified path in the environment
    // e.g. { $set: { $x: { y: 1 }, $x.z: 2 } }
    // note: "$x" is stored as simply "x" in the environment
    'set': async (declarationsObj, env, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const path = symbolToString(symbol)
        const evaluated = await evaluate(value, env)

        trace(`setting ${path} to eval of ${evaluated}`)

        set(env, path, evaluated)
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
      const lambda = async (invokedArgs, env, jexi) => {
        trace('handling lambda called with:', invokedArgs)

        // put the values passed for the arguments into a local scope
        // note: if called from javascript using the global vars is better than no vars at all
        //   (e.g. $for does a simple array.forEach which calls this lamdba function directly)
        const localContext = Object.create(jexi?.evaluate ? env : globals || null)

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
        trace('evaluating body of lambda:', JSON.stringify(body))
        const result = await evaluate(body, localContext)

        trace('got from evaluating body of lambda:', JSON.stringify(body), 'result:', result)

        return result
      }

      lambda._handler = true

      return lambda
    },

    // $if/cond/then/else is a special form because it only evaluates one of the if/else clauses
    // e.g. { $if: { cond: { '$>': [ '$x', 0 ] }, then: 'some' } }
    // or { $if: { cond: { '$>': [ '$x', 0 ] }, then: 'some', else: 'none' } }
    'if': async ({ cond, then, else: otherwise }, env, { evaluate }) =>
      await evaluate(cond, env) ?
        evaluate(then, env) :
        evaluate(otherwise, env),

    // // $jsonpath/path/in = return jsonpath matches within the specified json 
    // // e.g. { $jsonpath: { path: '$.store.book[*].author', in: { store: { book: [ { author: 'Tolkien' }]}}}}
    // // or from the env e.g. { $jsonpath: { path: '$.store.book[*].author', in: $payloads.bookStore }}
    // 'jsonpath': async ({ path, in: json }, env, { evaluate }) =>
    //   // don't evaluate the jsonpath because those often start with "$" which jexi
    //   // would try to interpret (most likely giving undefined) instead of jsonpath  
    //   JSONPath({ path, json: await evaluate(json, env) }),

    // this is really just a start at a way to exit evaluating early
    // (I was thinking/hoping evaluate can check this but it doesn't yet)
    'exit': (_args, _variables, trace, { globals }) => {
      trace('Setting global _exit flag to abort the evaluation')

      globals._exit = true
    },
  },

  macros: {
    // $function/name/args/do = a named function
    // { $function: { name: fnname, args: [ '$arg1', ..., '$argN'], do: [ function body ] }}
    // e.g. { $function: { name: '$print', args: [ '$msg' ], do: { $console.log: $msg }}}
    'function': ({ name, args, do: body }) => ({
      $var: { [name]: { '$=>': { args, do: body }}},
    }),

    // $foreach/in/as/do = for each array element do something (this is a simplified version of $for/in/do)
    // e.g.: { $foreach: { in: [ 0, 1, 2 ], as: $elem, do: { $console.log: $elem }}}
    'foreach': ({ in: array, as, do: body }) => ({
      '$for': { in: array, 'do': { '$=>': { args: [ as ], 'do': body }}},
    }),

    // $mapeach/in/as/by = map array data using a function
    // e.g. { $mapeach: { in: [ 0, 1, 2 ], as: $elem, by: { '$+': [ '$elem', 1 ] }}}
    'mapeach': ({ in: array, as, by: fn }) => ({
      $map: { in: array, by: { '$=>': { args: [ as ], 'do': fn }}},
    }),

    // $json = identify json as just data
    // this is just an alias for $quote (similar to "list" in lisp)
    'json': data => ({ $quote: data }),
  },

  // global values (not functions or special forms just values)
  globals: {
    console,
    JSON,
    Array,
    Object,
    Set,
    Map,
    Date,
    Math,
    Error,
  },
}
