import { interpreter } from '../src/index.js'

const evalFileAsync = filename => {
  const jexi = interpreter({}, { trace: false })

  return jexi.evaluate({ $run: filename })
}

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
  test('factorial.jexi', async () => {
    const jexi = interpreter({}, { trace: false })

    // create the environment shared across multiple evaluations below: 
    const env = jexi.createEnv()

    // load the file as jexi (json) forms into the env as 'jsonforms': 
    await jexi.evaluate({ $load: { file: 'examples/factorial.jexi', as: 'jsonforms' }}, env)

    // the first form in the $do array is the factorial function declaration:
    const factorialDeclaration = await jexi.evaluate({ $first: '$jsonforms.$do' }, env)

    // evaluating that will create the factorial function in the environment:
    await jexi.evaluate(factorialDeclaration, env)

    // now we can invoke it:
    expect(await jexi.evaluate({ $factorial: 5 }, env)).toEqual(120)
    expect(await jexi.evaluate({ $factorial: 12 }, env)).toEqual(479001600)
  })
})


