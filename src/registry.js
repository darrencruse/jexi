/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle, no-undef-init */
import { JSONPath } from 'jsonpath-plus'
import RJson from 'really-relaxed-json'
import fetch from 'cross-fetch'
import jsonata from 'jsonata'
import { readFile } from 'node:fs/promises'
import set from 'lodash.set'

const rjsonParser = RJson.createParser()

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

    // $read = read a .json or .jexi file's contents as JSON
    // e.g. read contents of data.json: { $read: 'examples/data.json' }
    // e.g. read contents of geodata.jexi converted to JSON: { $read: 'examples/geodata.jexi' }
    read: async filepath => {
      // eslint-disable-next-line no-unused-vars
      const [ _wholepath, _filepath, filename, extension ] =
        filepath.trim().match(/^(.+?\/)?([^./]+)(\.[^.]*$|$)/)
      let contentsStr = undefined

      try {
        contentsStr = await readFile(filepath, { encoding: 'utf8' })
      } catch (err) {
        throw new Error(`Could not read file '${filepath}': ${err}`)
      }

      let forms = undefined

      try {
        // note if there's no file extension we still run relaxed-json
        // (if it's JSON it just comes thru unchanged) 
        const jsonStr = !extension || extension === '.jexi' ?
          rjsonParser.stringToJson(contentsStr) :
          contentsStr

        forms = JSON.parse(jsonStr)
      } catch (err) {
        throw new Error(`The file '${filepath}' contains invalid JSON: ${err}`)
      }

      return forms
    },


    // fetch data from a url
    // this uses the whatwg fetch standard "fetch" available in browsers and node.js (via a polyfill)
    //
    // for details of the options available see e.g.
    // https://developer.mozilla.org/en-US/docs/Web/API/fetch
    // e.g. for a simple GET: { $fetch: 'http://jsonplaceholder.typicode.com/posts' }
    // or with options e.g. for POST:  { $fetch: [ 'http://jsonplaceholder.typicode.com/posts', {
    //   method: 'POST',
    //   body: {
    //     title: 'foo',
    //     body: 'bar',
    //     userId: 1,
    //   },
    // }]}
    //
    // this just calls the fetch api directly except we convert to json before returning the result
    //
    // TBD we've currently just assumed a json api is being accessed
    //   this may be loosened later on
    //
    // note:  this is currently not working with the experimental fetch in node v17.5.0+ (hence the polyfill)
    //   even worse polyfill(s?) seem not working in node versions newer than v16.19.0 - need to resolve
    //
    'fetch': async (url, options) => {
      // eslint-disable-next-line no-undef
      const res = await fetch(url, options)
      const json = await res.json()

      return json
    },
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
    // $eval = evaluate the specified json as jexi code
    // e.g. { $eval: { $read: 'examples/jsonpathex.jexi' } }
    eval: ([ arg ], env, jexi) => jexi.evaluate(arg, env),

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

    // $jsonpath[/path/in|'path'] = match jsonpath to current environment or specified 'in' json
    // e.g. using 'in': { $jsonpath: { path: '$.store.book[*].author', in: { store: { book: [ { author: 'Tolkien' }]}}}}
    // or from a var: e.g. { $jsonpath: { path: '$.store.book[*].author', in: $bookStore }}
    // or directly to the environment: { $jsonpath: '$.bookStore.store.book[*].author' }
    'jsonpath': ([ arg ], env) => {
      const path = typeof arg === 'string' ? arg : arg.path
      const json = arg.in || env

      return JSONPath({ path, json })
    },

    // $jsonata[/expr/in|'expression'] = run jsonata expression against current environment or specified 'in' json
    // e.g. using 'in': { $jsonata: { expr: '$.store.book.author', in: { store: { book: [ { author: 'Tolkien' }]}}}}
    // or from a var: e.g. { $jsonata: { expr: '$.store.book.author', in: $bookStore }}
    // or to the environment: { $jsonata: "$.bookStore.store.book.{ 'summary': $.title & ' by ' & $.author }"}
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

    // $local/var/in = defines a scope with one or more local variables
    // example: { $local: { var: {'$x': 1, '$y': 2}, in: [body uses $x and $y] }}
    // note lisps call this "let" but we use "local" to avoid confusion with
    // statically scoped "let" e.g. in languages like javascript 
    'local': async (varsInObj, env, { evaluate, createEnv, symbolToString, trace }) => {
      trace('in local:', varsInObj)

      const { var: declarationsObj, in: body } = varsInObj
      const letScope = createEnv(env)

      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        try {
          const name = symbolToString(symbol)

          trace('setting', name, 'to:', value)
          // eslint-disable-next-line no-await-in-loop
          letScope[name] = await evaluate(value, env)
          trace('read back:', letScope[name])
        } catch (err) {
          // TBD better error handling
          console.error('In $local exception:', err, 'evaluating:', JSON.stringify(value, null, 2))
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
    '=>': (argsDoObj, declareContext, { evaluate, createEnv, globals, symbolToString, trace }) => {
      trace('declaring the lambda:', argsDoObj)

      const { args: argNames, do: body } = argsDoObj

      // return a function called later when the $fn is actually called  
      const lambda = async (invokedArgs, env, jexi) => {
        trace('handling lambda called with:', invokedArgs)

        // put the values passed for the arguments into a local scope
        // note: if called from javascript using the global vars is better than no vars at all
        //   (e.g. $for does a simple array.forEach which calls this lamdba function directly)
        const localContext = createEnv(jexi?.evaluate ? env : globals || null)

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

    // $load[/file/as|'file'] = load a .json or .jexi file 'as' a name (otherwise as the filename sans extension)
    // (note the file contents are not evaluated - for that see "run/file")
    // e.g. { $load: 'examples/geodata.jexi' } = load contents of geodata.jexi converted to JSON as $geodata
    // or { $load: { file: 'examples/data.json', as: $geodata } = load contents of data.json as $geodata
    load: arg => {
      const filepath = typeof arg === 'string' ? arg : arg.file
      // eslint-disable-next-line no-unused-vars
      const [ _wholepath, _filepath, filename, filext ] =
        filepath.trim().match(/^(.+?\/)?([^./]+)(\.[^.]*$|$)/)
      const as = arg.as || filename

      return { '$set': { [as]: { '$read': filepath }}}
    },

    // $run[/file|'file'] = execute the contents of .json or .jexi file
    // e.g. { $run: 'examples/geodata.jexi' } = execute the contents of geodata.jexi
    // or { $run: { file: 'examples/data.json' } = run contents of data.json
    // note:  the '/file' option might have alternatives in the future e.g. '/url', '/s3', etc.?
    run: arg => {
      const filepath = typeof arg === 'string' ? arg : arg.file

      // note the below is wrapped in $do to get the result of the last operation
      // TBD need to clarify "template" versus "operations" type of usage(?)
      return { '$eval': { '$do': { '$read': filepath }}}
    },
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
