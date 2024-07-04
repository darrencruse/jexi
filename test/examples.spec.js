import { evalFileAsync, $eval, $evalsTo, testWithEnv } from './jexiTestHelpers.js'

describe('example files', () => {
  describe('mapex', () => {
    test('.json', async () => {
      expect(await evalFileAsync('examples/mapex.json')).toMatchObject([ 1, 2, 3 ])
    })

    test('.jexi', async () => {
      expect(await evalFileAsync('examples/mapex.jexi')).toMatchObject([ 1, 2, 3 ])
    })
  })

  // here though the factorial.jexi file is a little "program" we load the "code as data"
  // and test just the factorial function from it:
  testWithEnv('factorial.jexi', async env => {
    // load the file as jexi (json) forms into the env as 'jsonforms': 
    await $eval({ $load: 'examples/factorial.jexi', as: 'jsonforms' }, env)

    // the first form in the $do array is the factorial function declaration:
    const factorialDeclaration = await $eval({ $first: '$jsonforms.$do' }, env)

    // evaluating that will create the factorial function in the environment:
    await $eval(factorialDeclaration, env)

    // now we can invoke it:
    await $evalsTo({ $factorial: 5 }, env, 120)
    await $evalsTo({ $factorial: 12 }, env, 479001600)
  })
})


