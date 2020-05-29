const getArg = (form, name, pos) => Array.isArray(form) ? form[pos] : form[name]

module.exports = {
    // $let defines a scope with one or more local variables
    // define one: ["$let", ["$x", 1], [body uses "$x" ]]
    // define multiple: ["$let", [["$x", 1], ["$y", 2]], [body uses "$x" and "$y"]]
    $let: (form, context, interpret, trace) => {
        trace('in let:', form)
        const letContext = Object.create(context)
        // it's annoying when only defining one var to have to do wrap the var defs:
        // e.g. ['$let', [['$x', 'hello world']], '$x'] - so wrap it for them
        const varDefs = (form[1].length > 0 && Array.isArray(form[1][0])) ? form[1] : [form[1]]

        varDefs.forEach(([name, value]) => {
            trace('setting', name, 'to:', value)
            letContext[name] = interpret(value, context);
            trace('read back:', letContext[name])
        })

        return interpret(form[2], letContext);
    },

    // $var defines a variable in the current scope
    // e.g. ["$var", "$x", 1]
    $var: (form, context, interpret, trace) => {
        const name = Array.isArray(form) ? form[1] : form["$var"][0]
        const value = Array.isArray(form) ? form[2] : form["$var"][1]
        trace(`setting ${name} to ${value}`)      
        context[name] = interpret(value, context);

        // we intentionally evaluate to undefined here
        // because $var defining a function was getting called
        // at the declaration
        return undefined
    },

    // $=> = anonymous function
    // ["$=>", [ "$arg1", ..., "$argN"], [ function body ]]
    "$=>": (declareForm, declareContext, interpret, trace) => {
        trace('declaring the lambda:', {declareForm, declareContext, interpret})
        // return a function called later when the $fn is actually called  
        return (callForm, callContext) => {
            trace('handling the call:', callForm)
            // put the values passed for the arguments into a local scope
            const localContext= Object.create(callContext)
            declareForm[1].forEach((argname, i) => {
                // +1 below because the function is position 0
                trace('setting argument in local scope:', argname, callForm[i+1])
                localContext[argname] = callForm[i+1];
            });

            // evaluate the body of the function with it's args in scope:
            return interpret(declareForm[2], localContext);
        };
    },

    // $function = a named function
    // ["$function", "$name", [ "$arg1", ..., "$argN"], [ function body ]]
    $function: (form, context, interpret) =>
        interpret(["$var", form[1], ["$=>", form[2], form[3]]], context),
    
    // $if is a special form because it only evaluates one of the if/else clauses
    // e.g. ["$if", ["$>", "$x", 0], "some", "none"]
    // or { "$if" : ["$>", "$x", 0], "then": "some", "else": "none"}
    $if: (form, context, interpret) => {
        return interpret(getArg(form, '$if', 1), context) ?
            interpret(getArg(form, 'then', 2), context) :
            interpret(getArg(form, 'else', 3), context)
    }
}