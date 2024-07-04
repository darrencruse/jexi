// our "symbols" in JSON strings marked with a prefix "$"
// but being sure to ignore money e.g. "$1.50" or syntax that may
// arise when embedding *other* expression languages e.g.
// jsonpath ("$.prop"), jsonata ("$max(array)") etc.
export const symRegex = new RegExp('^\\$[^$0-9\\.\\[][^(){}]*$')

export const isSymbol = atom => typeof atom === 'string' && symRegex.test(atom)

// converting symbol to string just removes the $ prefix (if it has one)
export const symbolToString = symbolStr => isSymbol(symbolStr) ? symbolStr.substring(1) : String(symbolStr)

// converting string to symbol just adds the $ prefix
export const stringToSymbol = str => !isSymbol(str) ? `$${str.trim()}` : str

// return the "$function" symbol specified in the provided object form call { $function: [ args ] }.
// Otherwise null if there isn't one
export const getFnSymbolForForm = form => {
  let fnSymbol = null

  const keys = Object.keys(form) || []
  const symbols = keys.filter(isSymbol)

  if (symbols.length > 0) {
    fnSymbol = symbols[0]

    if (symbols.length > 1) {
      console.warn(`Warning: ambiguous object form with multiple "$function" keys (using ${fnSymbol}):`)
    }
  }

  return fnSymbol
}
