import {
  $eval,
  $evalsTo,
  $jexiEval,
  $jexiEvalsTo,
  testWithEnv,
} from './jexiTestHelpers.js'

describe('built-ins', () => {
  describe('$fn (lambdas)', () => {
    describe('positional args', () => {
      describe('json forms', () => {
        testWithEnv('single arg (with arg brackets)', async env => {
          await $eval({ $var: { $ident: { $fn: [ '$x' ], '=>': '$x' }}}, env)
          await $evalsTo({ $ident: 'y' }, env, 'y')
        })

        testWithEnv('single arg (omitting arg brackets)', async env => {
          await $eval({ $var: { $ident: { $fn: '$x', '=>': '$x' }}}, env)
          await $evalsTo({ $ident: 'y' }, env, 'y')
        })

        testWithEnv('multiple args', async env => {
          await $eval({ $var: { $addem: { $fn: [ '$x', '$y' ], '=>': { '$+': [ '$x', '$y' ]}}}}, env)
          await $evalsTo({ $addem: [ 1, 2 ]}, env, 3)
        })
      })

      // note the jexi (relaxed json) format doesn't require commas (though I still like them
      // in some places) nor the quotes around the "$symbols" (but note it still needs colons
      // after keys even the non-alpha ones like "=>:" or "$+:" that you might overlook)
      describe('jexi strings', () => {
        testWithEnv('single arg (with arg brackets)', async env => {
          await $jexiEval('{ $var: { $ident: { $fn: [ $x ] =>: $x }}}', env)
          await $jexiEvalsTo('{ $ident: "y" }', env, 'y')
        })

        testWithEnv('single arg (omitting arg brackets)', async env => {
          await $jexiEval('{ $var: { $ident: { $fn: $x =>: $x }}}', env)
          await $jexiEvalsTo('{ $ident: "y" }', env, 'y')
        })

        testWithEnv('multiple args', async env => {
          await $jexiEval('{ $var: { $addem: { $fn: [ $x, $y ] =>: { $+: [ $x $y ]}}}}', env)
          await $jexiEvalsTo('{ $addem: [ 1, 2 ]}', env, 3)
        })
      })
    })

    describe('named keyword args', () => {
      describe('json forms', () => {
        // note this case is just a different way to achieve the "single positional arg" case
        testWithEnv('function name only no keyword arg', async env => {
          await $eval({ $var: { $ident: { $fn: { $ident: '$x' }, '=>': '$x' }}}, env)

          // note inoking this looks no different than the "single positional arg" case
          // expect(await $eval2({ $ident: 'y' }, env)).toEqual('y')
          await $evalsTo({ $ident: 'y' }, env, 'y')
        })

        testWithEnv('multiple args', async env => {
          await $eval({ $var: { $addto: { $fn: { $addto: '$x', val: '$y' }, '=>': { '$+': [ '$x', '$y' ]}}}}, env)

          // invoke it using the object form "named arg" style:
          // the main fn name "addto" gets a value as well as the "val" keyword arg
          await $evalsTo({ $addto: 1, val: 2 }, env, 3)
        })
      })

      describe('jexi strings', () => {
        testWithEnv('function name only no keyword arg', async env => {
          await $jexiEval('{ $var: { $ident: { $fn: { $ident: $x } =>: $x }}}', env)
          await $jexiEvalsTo('{ $ident: "y" }', env, 'y')
        })

        testWithEnv('multiple args', async env => {
          await $jexiEval('{ $var: { $addto: { $fn: { $addto: $x, val: $y } =>: { $+: [ $x, $y ]}}}}', env)
          await $jexiEvalsTo('{ $addto: 1, val: 2 }', env, 3)
        })
      })
    })
  })

  // note named functions are just shorter syntax sugar (a macro) for the "$var"s we did above in the $=> lamdba specs 
  describe('$fn (named functions)', () => {
    describe('positional args', () => {
      testWithEnv('single arg (with arg brackets)', async env => {
        await $eval({ $function: { $ident: [ '$x' ]}, '=>': '$x' }, env)

        await $evalsTo({ $ident: 'y' }, env, 'y')
      })

      testWithEnv('single arg (omitting arg brackets)', async env => {
        await $eval({ $function: { $ident: '$x' }, '=>': '$x' }, env)

        await $evalsTo({ $ident: 'y' }, env, 'y')
      })

      testWithEnv('multiple args', async env => {
        await $eval({ $function: { $addem: [ '$x', '$y' ]}, '=>': { '$+': [ '$x', '$y' ]}}, env)

        await $evalsTo({ $addem: [ 1, 2 ]}, env, 3)
      })
    })

    describe('named args', () => {
      testWithEnv('function name arg plus keyword arg', async env => {
        await $eval({ $function: { $addto: '$x', val: '$y' }, '=>': { '$+': [ '$x', '$y' ]}}, env)

        await $evalsTo({ $addto: 1, val: 2 }, env, 3)
      })
    })
  })

  describe('$if', () => {
    describe('$if/then (no else)', () => {
      testWithEnv('condition true', async env => {
        await $evalsTo({ $if: true, then: 'yes' }, env, 'yes')
      })
      testWithEnv('condition false', async env => {
        await $evalsTo({ $if: false, then: 'yes' }, env, undefined)
      })
    })
  })

  describe('$if/then/else', () => {
    testWithEnv('condition true', async env => {
      await $evalsTo({ $if: true, then: 'yes', else: 'no' }, env, 'yes')
    })
    testWithEnv('condition false', async env => {
      await $evalsTo({ $if: false, then: 'yes', else: 'no' }, env, 'no')
    })
  })

  // have temporarily named the new $map as $mapBy I will rename it to $map when I'm sure it's working
  describe('$map', () => {
    describe('using a lambda', () => {
      testWithEnv('simple identity function', async env => {
        await $evalsTo({ $map: [ 0, 1, 2 ], to: { $fn: '$x', '=>': '$x' }}, env, [ 0, 1, 2 ])
      })
      testWithEnv('add one', async env => {
        await $evalsTo({ $map: [ 0, 1, 2 ], to: { $fn: '$elem', '=>': { '$+': [ '$elem', 1 ]}}}, env, [ 1, 2, 3 ])
      })
    })
  })
})


