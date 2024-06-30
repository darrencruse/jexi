import { $eval, $evalsTo, testWithEnv } from './jexiTestHelpers.js'

describe('built-ins', () => {
  describe('$=> (lambdas)', () => {
    testWithEnv('identity function', async env => {
      // declare the lambda as $ident in the environment
      await $eval({ $var: { $ident: { $fn: '$x', '=>': '$x' }}}, env)

      // invoke it
      $evalsTo({ $ident: 'y' }, env, 'y')
    })

    testWithEnv('multiple arguments', async env => {
      // declare the lambda as $addem
      await $eval({ $var: { $addem: { $fn: [ '$x', '$y' ], '=>': { '$+': [ '$x', '$y' ]}}}}, env)

      // invoke it
      $evalsTo({ $addem: [ 1, 2 ]}, env, 3)
    })
  })

  // named functions are just shorter syntax sugar (a macro) for the "$var"s we did above in the $=> lamdba specs 
  describe('$fn (named functions)', () => {
    testWithEnv('identity function', async env => {
      // declare function "$ident"
      await $eval({ $function: '$ident', args: '$x', '=>': '$x' }, env)

      // invoke it
      $evalsTo({ $ident: 'y' }, env, 'y')
    })

    testWithEnv('multiple arguments', async env => {
      // declare function "$addem"
      await $eval({ $function: '$addem', args: [ '$x', '$y' ], '=>': { '$+': [ '$x', '$y' ]}}, env)

      // invoke it
      $evalsTo({ $addem: [ 1, 2 ]}, env, 3)
    })
  })

  // I NEED TO IMPLEMENT AND TEST FUNCTIONS TAKING THE NAMED PARAMETER KEYWORD ARGS STYLE

  describe('$if', () => {
    describe('$if/then (no else)', () => {
      testWithEnv('condition true', env => {
        $evalsTo({ $if: true, then: 'yes' }, env, 'yes')
      })
      testWithEnv('condition false', env => {
        $evalsTo({ $if: false, then: 'yes' }, env, undefined)
      })
    })
  })

  describe('$if/then/else', () => {
    testWithEnv('condition true', env => {
      $evalsTo({ $if: true, then: 'yes', else: 'no' }, env, 'yes')
    })
    testWithEnv('condition false', env => {
      $evalsTo({ $if: false, then: 'yes', else: 'no' }, env, 'no')
    })
  })

  // have temporarily named the new $map as $mapBy I will rename it to $map when I'm sure it's working
  describe('$map', () => {
    describe('using a lambda', () => {
      testWithEnv('simple identity function', env => {
        $evalsTo({ $map: [ 0, 1, 2 ], to: { $fn: '$x', '=>': '$x' }}, env, [ 0, 1, 2 ])
      })
      testWithEnv('add one', env => {
        $evalsTo({ $map: [ 0, 1, 2 ], to: { $fn: '$elem', '=>': { '$+': [ '$elem', 1 ]}}}, env, [ 1, 2, 3 ])
      })
    })
  })
})


