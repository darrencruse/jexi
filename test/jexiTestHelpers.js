import { interpreter } from '../src/index.js'

const jexi = interpreter({}, { trace: false })

// for testing with json forms:
export const $eval = (form, env) => jexi.evaluate(form, env)
export const $evalsTo = async (form, env, expected) => expect(await $eval(form, env)).toEqual(expected)

// for testing with jexi (relaed json) strings:
export const $jexiEval = (source, env) => jexi.evalJexiStr(source, env)
export const $jexiEvalsTo = async (source, env, expected) => expect(await $jexiEval(source, env)).toEqual(expected)

// get the environment used with the above calls injected:
export const testWithEnv = (name, testFn) => test(name, async () => {
  await testFn(jexi.createEnv())
})

// for testing with .jexi/.json files:
export const evalFileAsync = filename => jexi.evaluate({ $run: filename })

