import { interpreter } from './index.js'

const jexi = interpreter({ lodash: true, trace: false })

// eslint-disable-next-line no-console
console.log('Starting Assembler REPL...')

jexi.repl({ prompt: 'jexi>', relaxed: true })
