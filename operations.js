
// replace arrayify with lodash
const arrayify = arr => Array.isArray(arr) ? arr : [arr]
const formtoargs = (fnsymbol, cb, form) =>
    cb.apply(undefined, Array.isArray(form) ? form.slice(1) : arrayify(form[fnsymbol]))
const sargs = (symbol, cb) => formtoargs.bind(undefined, symbol, cb)

module.exports = {
    $do: sargs("$do", (...evaledForms) => evaledForms.length > 0 ? evaledForms[evaledForms.length-1] : evaledForms),
    $print: sargs("$print", args => console.log.apply(null, args)),

    "$!": sargs("$!", operand => !operand),    
    "$&&": sargs("$&&", (lhs, rhs) => lhs && rhs),
    "$||": sargs("$||", (lhs, rhs) => lhs || rhs),
    "$+": sargs("$+", (lhs, rhs) => lhs + rhs),
    "$+": sargs("$+", (lhs, rhs) => lhs + rhs),
    "$-": sargs("$-", (lhs, rhs) => lhs - rhs),
    "$*": sargs("$*", (lhs, rhs) => lhs * rhs),
    "$/": sargs("$/", (lhs, rhs) => lhs / rhs),
    "$%": sargs("$%", (lhs, rhs) => lhs % rhs),   
    "$==": sargs("$==", (lhs, rhs) => lhs == rhs),
    "$!=": sargs("$!=", (lhs, rhs) => lhs != rhs),
    "$===": sargs("$===", (lhs, rhs) => lhs === rhs),
    "$!==": sargs("$!==", (lhs, rhs) => lhs !== rhs),
    "$>": sargs("$>", (lhs, rhs) => lhs > rhs),
    "$>=": sargs("$>=", (lhs, rhs) => lhs >= rhs),
    "$<": sargs("$<", (lhs, rhs) => lhs < rhs),
    "$<=": sargs("$<=", (lhs, rhs) => lhs <= rhs),

    $pi: 3.1415927,
}