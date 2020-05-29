/* eslint-disable implicit-arrow-linebreak */
import castArray from 'lodash.castarray'

const formtoargs = (fnsymbol, cb, form) =>
  cb(...Array.isArray(form) ? form.slice(1) : castArray(form[fnsymbol]))
const sargs = (symbol, cb) => formtoargs.bind(undefined, symbol, cb)

export default {
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

  $pi: 3.1415927,
}
