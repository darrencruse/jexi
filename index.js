// will change to es6 module later the node repl is giving me trouble

const interpreter = (options = {}) => {
    //options.trace = true

    const trace = (...args) => options.trace && console.log.apply(null, args)

    // our "symbols" in JSON strings marked with a prefix "$"
    // but being sure to ignore money e.g. "$1.50" or syntax that may
    // arise when embedding *other* expression languages e.g.
    // jsonpath ("$.prop"), jsonata ("$max(array)") etc.
    const symbolDetector = options.symbolDetector || '^\\$[^\$0-9][^(){}]*$'
    const symRegex = new RegExp(symbolDetector);
    // I originally used this to say $ followed by valid javascript var name,
    // but I changed to the above to support things like "$>=", "$!==" etc.
    //const symRegex = new RegExp('^\\' + symbolChar + '[A-Z_][0-9A-Z_$]*$', 'i');
 
    const isSymbol = atom => typeof atom === 'string' && symRegex.test(atom)

    // unquoting the symbol string just removes the $ prefix
    const unquoteSymbol = symbolStr => symbolStr.substring(1)

    // special forms
    const baseSpecials = require('./specialForms.js')
    const specialForms = { ...baseSpecials, ...(options.specialForms || {}) }

    trace('specialForms=', specialForms)

    // our registry of built in functions
    const baseOperations = require('./operations.js')
    const registry = { ...baseOperations, ...(options.operations || {}) }

    trace('registry=', registry)

    const globals = {
        params: { id: '1234567'},
        models: { AGENCY_REQUEST: { 'blah': 'blah' } }
    }

    // the array form is really the classic lispy s-expression form
    const interpretArrayForm = (sform, context) => {
        // special forms are called with their args unevaluated:
        if (sform.length > 0 && specialForms[sform[0]]) {
            return specialForms[sform[0]](sform, context, interpret, trace);
        } else {
            // regular forms have their args evaluated before they are called
            const possibleSym = sform[0]
            const evaluated = sform.map(atom => interpret(atom, context));
            trace('sform: evaluated before call:', JSON.stringify(evaluated, null, 2), evaluated[0], typeof evaluated[0])
            if (typeof evaluated[0] === 'function') {
                trace(`sform: calling ${possibleSym}`)
                return evaluated[0].call(undefined, evaluated, context, interpret, trace);
            } else {
                trace(`sform: ${possibleSym} not a function passing thru as evaluated data`)
                if (isSymbol(possibleSym) && typeof evaluated[0] === 'undefined') {
                    // this was an unrecognized symbol pass it thru unchanged
                    evaluated[0] = possibleSym
                }
                return evaluated;
            }
        }
    }

    // the object form is using json object keys like named arguments
    const interpretObjectForm = (oform, context) => {
        // special forms are called with their args unevaluated:
        const keys = Object.keys(oform) || []
        const symbol = keys.find(isSymbol)
        if (symbol) {
            if (specialForms[symbol]) {
                return specialForms[symbol](oform, context, interpret, interpret, trace);
            } else if (typeof registry[symbol] === 'function') {
                // regular sforms have their args evaluated before they are called
                // the equivalent here is the values of all keys are evaluated before the fn is called
                keys.forEach(key => {
                    oform[key] = interpret(oform[key], context);
                })

                trace(`oform: calling ${symbol}`)
                return registry[symbol].call(undefined, oform, context, interpret, trace);
            } else {
                trace(`passing thru object with unrecognized symbol key "${symbol}"`)
            }               
        }

        trace('oform: evaluting key values of plain of object as a template')
        keys.forEach(key => {
            oform[key] = interpret(oform[key], context);
        })

        return oform
    }

    const interpret = (form, context = globals) => {
        trace('interpret: evaluating:', JSON.stringify(form, null, 2))
        if (Array.isArray(form)) {
            return interpretArrayForm(form, context)
        } else if (typeof form === 'object') {
            return interpretObjectForm(form, context)
        } else if (isSymbol(form)) {
            trace(`interpret: replacing "${form}"/"${unquoteSymbol(form)}" value from context or registry`)
    // change to do these lookup using lodash get?
    // like what about reaching into nested objects in the assembly state?
            return context[form] || context[unquoteSymbol(form)] || registry[form]
        } else {
            trace(`interpret: passing ${form} thru as plain data`)
            return form
        }
    }

    return {
        isSymbol,
        interpret,
        eval: interpret,
    }
}

module.exports = {
    interpreter,
}