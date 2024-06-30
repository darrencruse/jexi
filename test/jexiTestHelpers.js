import { interpreter } from '../src/index.js'

const jexi = interpreter({}, { trace: false })

// just some helpers to shorten the specs below a little:
export const $eval = (form, env) => jexi.evaluate(form, env)
export const $evalsTo = async (form, env, expected) => expect(await $eval(form, env)).toEqual(expected)
export const testWithEnv = (name, testFn) => test(name, async () => {
  await testFn(jexi.createEnv())
})
export const evalFileAsync = filename => jexi.evaluate({ $run: filename })
