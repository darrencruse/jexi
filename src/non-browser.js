import { readFile } from 'fs/promises'
import RJson from 'really-relaxed-json'
import yargs from 'yargs'

const rjsonParser = RJson.createParser()

//
// Registry of browser-incompatible extensions
//
// note by keeping the below dependencies here (and out of the "builtins" registry.js)
// we avoid errors with browser bundlers like webpack (over e.g. readFile and yargs
// which don't have browser equivalents)
//
// these are installed in bin/jexi.js for command line/repl use but not referenced
// elsewhere so that browser bundlers don't include these.
//
const nodeSpecificExtensions = {
  plainFunctions: {
    // $read = read a .json or .jexi file's contents as JSON
    // e.g. read contents of data.json: { $read: 'examples/data.json' }
    // e.g. read contents of geodata.jexi converted to JSON: { $read: 'examples/geodata.jexi' }
    read: async filepath => {
      // eslint-disable-next-line no-unused-vars
      const [ _wholepath, _filepath, filename, extension ] =
        filepath.trim().match(/^(.+?\/)?([^./]+)(\.[^.]*$|$)/)
      let contentsStr = ''

      try {
        contentsStr = await readFile(filepath, { encoding: 'utf8' })
      } catch (err) {
        throw new Error(`Could not read file '${filepath}': ${err}`)
      }

      let forms = null

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
  },

  macros: {
    // $getparameters = get provided input parameters into the environment (as "$parameters" by default)
    // e.g. { $getparameters: [{ alias: "name", describe: "Your name", type: "string", demandOption: true }] }
    getparameters: ({ $getparameters: options }) => {
      const parameters = yargs(process.argv.slice(2))
        .usage(`Usage: $0 ${process.argv[2]} ${options.map(opt => `--${opt.alias} [${opt.type}]`).join(' ')}`)
        .demandOption(options.reduce((accum, opt) => opt.demandOption ? [ ...accum, opt.alias ] : accum, []))
        .argv

      delete parameters._
      delete parameters.$0

      return { $set: { $parameters: parameters }}
    },
  },
}

export default nodeSpecificExtensions
