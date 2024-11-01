/* eslint-disable implicit-arrow-linebreak, quote-props, no-underscore-dangle, no-undef-init */
import { JSONPath } from 'jsonpath-plus'
import { URL } from 'url'
import fetch from 'cross-fetch'
import jsonata from 'jsonata'
import _ from 'lodash'
import { getFnSymbolForForm } from './utils.js'

// originally got JEXI_HOME this way (it worked fine except for jest):
// note: jest has issues with import.meta.url there's a babel plugin being used to fix it
const JEXI_HOME = new URL('..', import.meta.url).pathname

const compiledJsonataMap = new Map()

const jsonataPromise = (expr, data, bindings) => new Promise((resolve, reject) => {
  expr.evaluate(data, bindings, (error, response) => {
    if (error) {
      reject(error)
    }
    resolve(response)
  })
})

const invokeFn = (fn, formOrArgs, env, jexi) => {
  if (fn._keyword || fn._positional) {
    return fn(formOrArgs, env, jexi)
  }

  return fn(...formOrArgs)
}

// the registry maps the built-in "$symbols" to javascript functions/values.
// the application adds to by passing similar to the below as "extensions"
// to the jexiInterpreter() create function
export default {
  // functions taking positional args (evaluated *before* they are called)
  // where { $fn: [ arg1, ..., argN ] } means to call $fn(arg1, ..., argN)
  // note: the hope is that plain javascript functions can be used for these
  //   without any special "adapter" code needed for jexi 
  plainFunctions: {
    'first': array => array[0],
    'rest': array => array.slice(1),
    'at': (array, index) => array[index],
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

    // by default we just log to the console:
    // eslint-disable-next-line no-console
    log: console.log,
  },

  // built-in keyworded function handlers
  // these handle the "object form" invocations with optional keyword arguments
  // e.g. $filter/where, $map/to, $load/as etc. with a main $fn function name and zero or more
  // "named parameter"/"keyword argument"/"refinements" as other object keys (without the "$" prefix)  
  // in jexi "keywordArgs" handlers differ from "plainFunctions" handlers in how they are called
  // for "plainFunctions" { $fn: [ arg1, ..., argN ] } means to call $fn(arg1, ..., argN)
  // CORRECT THE COMMENTS BELOW
  // for "keywordArgs" { $fn: [ arg1, ..., argN ] } means to call $fn([ arg1, ..., argN ], env, jexi) so that:
  // a.  no argument spreading occurs (e.g. the first argument to $fn is always just an array of the args)
  // b.  access is provided to the variables context thru the env argument
  // c.  the interpreter can be re-entered using jexi.evaluate when necessary
  // d.  tracing can be done using jexi.trace
  // etc.
  // note: it is 
  keywordArgs: {
    // $eval = evaluate the specified json as jexi code
    // e.g. { $eval: { $read: 'examples/jsonpathex.jexi' } }
    eval: ({ $eval }, env, jexi) => jexi.evaluate($eval, env),

    // $for/do = for each array element do a lamdba
    // e.g.: { $for: [ 0, 1, 2 ], each: { '$fn': [ '$elem' ], =>: { '$console.log': '$elem' }}}
    'for': async ({ $for: array, each: fn }, env, jexi) => {
      for await (const elem of array) {
        // note right now I've still got $fun in progress meant to replace $=>
        // and $=> is still calling the old way passing the args array not passing the "form"
        // THIS NEEDS TO GET RESOLVED THE SECOND ARG HERE WOULD DIFFER FOR KEYWORD ARGS
        invokeFn(fn, [ elem ], env, jexi)
      }
    },

    // $map/to = map array data using a lambda function
    // e.g. { $map: [ 0, 1, 2 ], to: { $fn: $elem, =>: { $+: [ $elem 1 ]}}}
    'map': async ({ $map: array, to }, env, jexi) => {
      // note as a handler (as opposed to a macro) the => declaration has already been evaluated
      // to a javascript function
      // THIS NEEDS TO GET RESOLVED THE SECOND ARG HERE WOULD DIFFER FOR KEYWORD ARGS
      const mapPromises = array.map(elem => invokeFn(to, [ elem ], env, jexi))

      // await promises for the results (if promises came back)
      const resolved = Array.isArray(mapPromises) && mapPromises.length > 0 && mapPromises[0].then ?
        await Promise.all(mapPromises) : mapPromises

      return resolved
    },

    // $filter/where = filter array data using a predicate
    // e.g. { $filter: [ -1 0 1 ] where: { $fn: $elem =>: { $>: [ $elem 0 ]}}}
    'filter': async ({ $filter: array, where: fn }, env, { evaluate }) => {
      const inOrOut = await evaluate({ $map: array, to: fn }, env)

      return array.filter((_elem, i) => inOrOut[i])
    },

    // $jsonpath[/in] = match jsonpath to current environment or specified 'in' json
    // e.g. using 'in': { $jsonpath: '$.store.book[*].author', in: { store: { book: [ { author: 'Tolkien' }]}}}
    // or from a var: e.g. { $jsonpath: '$.store.book[*].author', in: $bookStore }
    // or directly to the environment: { $jsonpath: '$.bookStore.store.book[*].author' }
    'jsonpath': ({ $jsonpath: path, in: data }, env) => {
      const json = data || env

      return JSONPath({ path, json })
    },

    // $jsonata[/in] = run jsonata expression against current environment or specified 'in' json
    // e.g. using 'in': { $jsonata: '$.store.book.author', in: { store: { book: [ { author: 'Tolkien' }]}}}
    // or from a var: e.g. { $jsonata: '$.store.book.author', in: $bookStore }
    // or to the environment: { $jsonata: "$.bookStore.store.book.{ 'summary': $.title & ' by ' & $.author }"}
    'jsonata': async ({ $jsonata: expression, in: data }, env) => {
      const json = data || env
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

    // $load[/as] = load a .json or .jexi file 'as' a name (otherwise as the filename sans extension)
    // (note the file contents are not evaluated - for that see "$run/file")
    // e.g. { $load: 'examples/geodata.jexi' } = load contents of geodata.jexi converted to JSON as $geodata
    // or { $load: 'examples/data.json', as: 'geodata' } = load contents of data.json as $geodata
    load: ({ $load: filepath, as }, env, jexi) => {
      // eslint-disable-next-line no-unused-vars
      const [ _wholepath, _filepath, filename, filext ] =
        filepath.trim().match(/^(.+?\/)?([^./]+)(\.[^.]*$|$)/)
      const varName = as || filename

      return jexi.evaluate({ '$set': { [varName]: { '$read': filepath }}}, env)
    },
  },

  // special forms are like normal functions but "special" in that
  // they don't have their arguments evaluated before they are called
  // most special forms define control structures or perform variable bindings
  specialForms: {
    // $quote = return the quoted form as plain json unevaluated
    // e.g.  { $quote: '$.store.book[*].author' }
    // IS THIS SUFFICIENT FOR QUOTE?  READ UP ABOUT QUOTE/QUASIQUOTE EG IN THE MAL TUTORIAL?
    'quote': ({ $quote: unevaluatedForm }) => unevaluatedForm,

    // $new = constructs an instance using javascript "new"
    // example: { $new: { $Date: [ 'December 17, 1995 03:24:00' ] } }
    'new': async ({ $new: classAndArgs }, env, { evaluate, trace }) => {
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
    'local': async ({ $local: varsInObj }, env, { evaluate, createEnv, symbolToString, trace }) => {
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
    'var': async ({ $var: declarationsObj }, env, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const name = symbolToString(symbol)

        trace(`setting ${name} to ${value}`)
        env[name] = await evaluate(value, env)
      }

      // we intentionally evaluate to undefined here
      // because $var defining a function was getting called
      // at the declaration
      // TBD this seems surprising shouldn't this return the last declaration's value?
      return undefined
    },

    // $set assigns a value at a specified path in the environment
    // e.g. { $set: { $x: { y: 1 }, $x.z: 2 } }
    // note: "$x" is stored as simply "x" in the environment
    'set': async ({ $set: declarationsObj }, env, { evaluate, symbolToString, trace }) => {
      for await (const [ symbol, value ] of Object.entries(declarationsObj)) {
        const path = symbolToString(symbol)
        const evaluated = await evaluate(value, env)

        trace(`setting ${path} to eval of ${evaluated}`)

        _.set(env, path, evaluated)
      }

      // we intentionally evaluate to undefined here
      return undefined
    },

    // $fn/=> = lamdba (anonymous function)
    //
    // with positional arguments:
    //   { $fn: [ $arg1, ..., $argN], =>: [ function body ] } }
    //   e.g. { $fn: [ '$x', '$y' ], '=>': { '$+': [ '$x', '$y' ]}}
    //
    // with named (keyword) arguments:
    //   { $fn: { key1: $key1arg, ..., keyN: $keyNarg }, =>: [ function body ] } }
    //   e.g. { $fn: { $addto: '$x', val: '$y' }, '=>': { '$+': [ '$x', '$y' ]}}
    //
    'fn': (form, declareContext, { evaluate, createEnv, globals, symbolToString, trace }) => {
      trace('declaring the lambda:', form)

      const { $fn: argsSpec, '=>': body } = form

      let positionalParams = undefined
      let keywordArgsToParams = undefined

      if (typeof argsSpec !== 'object' || Array.isArray(argsSpec)) {
        // note castArray below allows { $fn: $x => $x } as a shorthand for { $fn: [ $x ] => $x }
        positionalParams = _.castArray(argsSpec)
      } else {
        // with positional args the parameter names are obviously in the order of their array
        // for keyword args they use the object to map the object key names ("$addto", "val" above)
        // to their chosen parameter names for each (i.e, the "x", "y" above) 
        keywordArgsToParams = argsSpec
        // DELETE parameterNames = Object.values(argsSpec)
      }

      // return a function called later when the $fn is actually called  
      const lambda = async (invokedArgs, env, jexi) => {
        trace('handling lambda called with:', invokedArgs)

        // put the values passed for the arguments into a new local scope
        // note: if called from javascript using globals as the parent is better than no vars at all
        // (e.g. $for does an array.forEach calling this lamdba function directly with no env/jexi args)
        const localContext = createEnv(jexi?.evaluate ? env : globals || null)

        if (positionalParams && Array.isArray(invokedArgs)) {
          positionalParams.forEach((paramNameSymbol, i) => {
            const paramName = symbolToString(paramNameSymbol)

            trace('setting arg in local scope:', paramName, invokedArgs[i])
            localContext[paramName] = invokedArgs[i]
          })
        } else if (keywordArgsToParams && typeof invokedArgs === 'object') {
          for (const [ keyword, paramNameSymbol ] of Object.entries(keywordArgsToParams)) {
            if (invokedArgs[keyword]) {
              const paramName = symbolToString(paramNameSymbol)

              trace('setting arg in local scope:', paramName, invokedArgs[keyword])
              localContext[paramName] = invokedArgs[keyword]
            }
          }
        } else if (positionalParams) {
          // DOUBLE CHECK IS THIS DEFINITELY STILL USED/NEEDED?
          const argname = symbolToString(positionalParams[0] || positionalParams)

          trace('setting arg in local scope:', argname, invokedArgs)
          localContext[argname] = invokedArgs
        }

        // evaluate the body of the function with it's args in scope:
        trace('evaluating body of lambda:', JSON.stringify(body))
        const result = await evaluate(body, localContext)

        trace('got from evaluating body of lambda:', JSON.stringify(body), 'result:', result)

        return result
      }

      lambda[keywordArgsToParams ? '_keyword' : '_positional'] = true

      return lambda
    },

    // $if/then/else is a special form because it only evaluates one of the if/else clauses
    // e.g. { $if: { '$>': [ '$x', 0 ] }, then: 'some' }
    // or { $if: { '$>': [ '$x', 0 ] }, then: 'some', else: 'none' }
    'if': async ({ $if: cond, then, else: otherwise }, env, { evaluate }) =>
      await evaluate(cond, env) ?
        evaluate(then, env) :
        evaluate(otherwise, env),

    // this is really just a start at a way to exit evaluating early
    // (I was thinking/hoping evaluate can check this but it doesn't yet)
    'exit': (_form, _variables, trace, { globals }) => {
      trace('Setting global _exit flag to abort the evaluation')

      globals._exit = true
    },
  },

  macros: {
    // $function/=> = a named function
    //
    // for positional args:
    //   { $function: { $fnname: [ '$arg1', ..., '$argN'] }, =>: [ function body ] }
    // e.g. { $function: { $addem: [ '$x', '$y' ]}, '=>': { '$+': [ '$x', '$y' ]}}
    //
    // for named (keyword) args:
    //   { $function: { $fnname: '$fnvalarg', key1: '$key1arg', ..., keyN: '$keyNarg' }, =>: [ function body ] }
    // e.g. { $function: { $addto: '$x', val: '$y' }, '=>': { '$+': [ '$x', '$y' ]}}
    //
    'function': ({ $function: objectPattern, '=>': body }) => {
      const $fnSymbol = getFnSymbolForForm(objectPattern)
      const fnameValue = objectPattern[$fnSymbol]

      // positional args normally use an array (but can omit them for single arg functions)
      if (Array.isArray(fnameValue) || Object.keys(objectPattern)?.length === 1) {
        // because the array declares the arg positions to $fn:
        // e.g. for the above the $fn is: { $fn: [ '$x', '$y' ], '=>': { '$+': [ '$x', '$y' ]}}
        return { $var: { [$fnSymbol]: { $fn: fnameValue, '=>': body }}}
      }

      // but the named args come from the keys so $fn gets the object
      // e.g. for the above the $fn is: { $fn: { $addto: '$x', val: '$y' }, '=>': { '$+': [ '$x', '$y' ]}}
      return { $var: { [$fnSymbol]: { $fn: objectPattern, '=>': body }}}
    },

    // $foreach/as/do = for each array element do something (this is a simplified version of $for/each)
    // e.g.: { $foreach: [ 0, 1, 2 ], as: $elem, do: { $console.log: $elem } }
    'foreach': ({ $foreach: array, as, do: body }) => ({
      '$for': array, 'each': { '$fn': [ as ], '=>': body },
    }),

    // $mapeach/as/to = map array data using a function (this is a simplified version of $map/to)
    // e.g. { $mapeach: [ 0, 1, 2 ], as: $elem, to: { '$+': [ '$elem', 1 ] }}}
    // HOPEFULLY IN THE FUTURE I SUPPORT THE BELOW AS 'map/as/to' WHERE I CONCATENATE THE OBJECT KEYS
    // AND LOOK FIRST IN THE REGISTRY FOR THAT AND WHEN NOT FOUND WOULD FALL BACK TO JUST 'map'
    // IE THIS WAY I DONT HAVE TO NAME THIS $mapeach ITS REALLY JUST A VARATION OF $map
    'mapeach': ({ $mapeach: array, as, to: body }) => ({
      $map: array, to: { '$fn': [ as ], '=>': body },
    }),

    // $json = identify json as just data
    // this is just an alias for $quote (similar to "list" in lisp)
    'json': ({ $json }) => ({ $quote: $json }),

    // $run[/file|'file'] = execute the contents of .json or .jexi file
    // e.g. { $run: 'examples/geodata.jexi' } = execute the contents of geodata.jexi
    // or { $run: { file: 'examples/data.json' } = run contents of data.json
    // note:  the '/file' option might have alternatives in the future e.g. '/url', '/s3', etc.?
    run: ({ $run: arg }) => {
      const filepath = typeof arg === 'string' ? arg : arg.file

      // note the below is wrapped in $do to get the result of the last operation
      // TBD need to clarify "template" versus "operations" type of usage(?)
      return { '$eval': { '$do': { '$read': filepath }}}
    },
  },

  // "handlers" are extension points for jexi client code to handle jexi interpreter "events"
  handlers: {
    // onNotFound is called when jexi encounters a json form with a "$fn" key where "fn" is
    // not found in the environment (analous to e.g. "missing method" in other languages)
    'onNotFound': (jsonForm, env, { getFnSymbolForForm, trace }) => {
      // TBD this should probably change to being an error...
      // i.e. this is more likely a typo than an intention to pass thru data with $ in a key?
      // maybe add a global 'strictMode' that if true means error and if false means pass thru?
      const $fnSymbol = getFnSymbolForForm(jsonForm)

      trace(`onNotFound: passing thru object with unrecognized symbol key "${$fnSymbol}":`, JSON.stringify(jsonForm, null, 2))

      return jsonForm
    },

    // onPlainJson is called when jexi encounters a json form that has no "$fn" symbol key
    // and is therefore assumed to be plain json data.  This handler allows client code to
    // customize how such json is processed (by default we treat it as a json template that
    // might have jexi forms nested within it)
    'onPlainJson': (jsonData, env, { evaluateKeys, trace }) => {
      trace('onPlainJson: evaluating key values of plain object as a template')

      // note the following may be bad for performance with large payloads
      // they can use $quote/$json to mark data they know doesn't need to evaluated
      // TBD is defaulting to evaluating everything the best though?  could I
      //  have e.g. "$template" to indicate eval is needed everywhere but not 
      //  do that by default
      return evaluateKeys(jsonData, env)
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
    JEXI_HOME,
    PWD: process.env.PWD,
    // lodash functions available as $_.functionName
    _,
  },
}
