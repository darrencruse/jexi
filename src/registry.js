/* eslint-disable implicit-arrow-linebreak */
import castArray from 'lodash.castarray'
import set from 'lodash.set'

const formtoargs = (fnsymbol, cb, form) =>
  cb(...Array.isArray(form) ? form.slice(1) : castArray(form[fnsymbol]))
const sargs = (symbol, cb) => formtoargs.bind(undefined, symbol, cb)

const getArg = (form, name, pos) => Array.isArray(form) ? form[pos] : form[name]

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
    $let: async (form, variables, trace, { evaluate }) => {
      trace('in let:', form)
      const letScope = Object.create(variables)
      // it's annoying when only defining one var to have to do wrap the var defs:
      // e.g. ['$let', [['$x', 'hello world']], '$x'] - so wrap it for them
      const varDefs = form[1].length > 0 && Array.isArray(form[1][0]) ? form[1] : [ form[1] ]

      for (const [ name, value ] of varDefs) {
        try {
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
    $var: async (form, variables, trace, { evaluate, symbolToString }) => {
      const name = Array.isArray(form) ? form[1] : form.$var[0]
      const baseName = symbolToString(name)
      const value = Array.isArray(form) ? form[2] : form.$var[1]

      trace(`setting ${baseName} to ${value}`)
      variables[baseName] = await evaluate(value, variables)

      // we intentionally evaluate to undefined here
      // because $var defining a function was getting called
      // at the declaration
      return undefined
    },

    // $set assigns a value at a specified path in variables
    // e.g. ["$set", "$x", 1] or { "$set": [ "$x.y": "$y" ]}
    // note: "$x" is set as simply "x" in the variables
    $set: async (form, variables, trace, { evaluate, symbolToString }) => {
      const path = Array.isArray(form) ? form[1] : form.$set[0]
      const basePath = symbolToString(path)
      const value = Array.isArray(form) ? form[2] : form.$set[1]

      trace(`setting ${basePath} to ${value}`)
      set(variables, basePath, await evaluate(value, variables))

      // we intentionally evaluate to undefined here
      return undefined
    },

    // $=> = anonymous function
    // ["$=>", [ "$arg1", ..., "$argN"], [ function body ]]
    '$=>': (declareForm, declareContext, trace, { evaluate }) => {
      trace('declaring the lambda:', { declareForm, declareContext, evaluate })

      // return a function called later when the $fn is actually called  
      return (callForm, callContext) => {
        trace('handling the call:', callForm)
        // put the values passed for the arguments into a local scope
        const localContext = Object.create(callContext)

        declareForm[1].forEach((argname, i) => {
          // +1 below because the function is position 0
          trace('setting argument in local scope:', argname, callForm[i + 1])
          localContext[argname] = callForm[i + 1]
        })

        // evaluate the body of the function with it's args in scope:
        return evaluate(declareForm[2], localContext)
      }
    },

    // $function = a named function
    // ["$function", "$name", [ "$arg1", ..., "$argN"], [ function body ]]
    $function: (form, variables, _trace, { evaluate }) =>
      evaluate([ '$var', form[1], [ '$=>', form[2], form[3] ]], variables),

    // $if is a special form because it only evaluates one of the if/else clauses
    // e.g. ["$if", ["$>", "$x", 0], "some", "none"]
    // or { "$if" : ["$>", "$x", 0], "then": "some", "else": "none"}
    $if: async (form, variables, _trace, { evaluate }) =>
      await evaluate(getArg(form, '$if', 1), variables) ?
        evaluate(getArg(form, 'then', 2), variables) :
        evaluate(getArg(form, 'else', 3), variables),
  },

  // the built-in "$functions" provided by the interpreter
  // unlike special forms these have their arguments evaluated before they are called
  functions: {
    $do: sargs('$do', (...evaledForms) => evaledForms.length > 0 ? evaledForms[evaledForms.length - 1] : evaledForms),
    // eslint-disable-next-line no-console
    $print: sargs('$print', args => console.log.apply(null, args)),

    '$!': sargs('$!', operand => !operand),
    '$&&': sargs('$&&', (lhs, rhs) => lhs && rhs),
    '$||': sargs('$||', (lhs, rhs) => lhs || rhs),
    '$+': sargs('$+', (lhs, rhs) => lhs + rhs),
    '$-': sargs('$-', (lhs, rhs) => lhs - rhs),
    '$*': sargs('$*', (lhs, rhs) => lhs * rhs),
    '$/': sargs('$/', (lhs, rhs) => lhs / rhs),
    '$%': sargs('$%', (lhs, rhs) => lhs % rhs),
    // eslint-disable-next-line eqeqeq
    '$==': sargs('$==', (lhs, rhs) => lhs == rhs),
    // eslint-disable-next-line eqeqeq
    '$!=': sargs('$!=', (lhs, rhs) => lhs != rhs),
    '$===': sargs('$===', (lhs, rhs) => lhs === rhs),
    '$!==': sargs('$!==', (lhs, rhs) => lhs !== rhs),
    '$>': sargs('$>', (lhs, rhs) => lhs > rhs),
    '$>=': sargs('$>=', (lhs, rhs) => lhs >= rhs),
    '$<': sargs('$<', (lhs, rhs) => lhs < rhs),
    '$<=': sargs('$<=', (lhs, rhs) => lhs <= rhs),
  },
}
