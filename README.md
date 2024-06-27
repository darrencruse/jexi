# Jexi
Jexi is all about "executable JSON"

"Jexi" stands for 'json expression interpreter'

The key ideas in Jexi are:

* Jexi embraces lisp's "code is data" philosophy except that in Jexi "code is JSON"

  (Jexi is a really lisp interpreter reimagined using JSON)

* Since JSON is language neutral the hope is that Jexi interpreters written in multiple languages might be created in the future

  (this version is in javascript and is tested in node.js and the browser)

* Since Jexi code is JSON it is easy to store/query/manipulate it e.g. in MongoDB, send it over the wire via api calls, etc.

* Jexi code might be ideal for saving from GUIs ala Low-Code/No-Code solutions

* since JSON has no notion of "symbols" in Jexi function/variable/etc. names are simply strings that start with "$"

* whereas in lisp functions are called like:

   `(fname arg1 ... argN)`

  In Jexi the canonical way to invoke functions are using a single key object like:
  
    `{ "$fname": [ arg1, ..., argN ] }`

  i.e. where in lisp you write: `(+ 1 1)`

  in Jexi you write: `{ "$+": [ 1, 1 ] }`

  you can think of single "$" key objects like the above as Jexi's *o-expression* answer to Lisp *s-expressions*  

* Jexi encourages named arguments (ala Smalltalk) using JSON object keys like:

  `{ "$fname": { "argname1": arg1, ..., "argnameN": argN } }`

  e.g. 
  
  ```
  {
    "$foreach": {
      "in": [ 0, 1, 2 ],
      "as": "$elem",
      "do": {
        "$console.log": "$elem"
      }
    }
  }
  ```

  for clarity a function such as the above is referred to as `$foreach/in/as/do`

  note that by convention the function name `$foreach` is prefixed with `$` but the named arguments (i.e. `in`, `as`, `do`) are not

  names preceded with `$` are variables resolved within the environment (e.g. `$foreach` is a function resolved in the environment while `in`, `as`, and `do` are not)

* Since getting all the quotes etc. correct in JSON can be a challenge Jexi makes use of the "relaxed-json" package which allows you to omit the extra quotes on symbols to read nicer (more like JSON in a javascript file allows) and relaxed-json even goes further as you can see here:

  ```
  {
    // most quotes (and even commas) are optional:
    // and yes comments (such as this one :) are allowed
    $foreach: {
      in: [ 0 1 2 ]
      as: $elem
      do: {
        $console.log: $elem
      }
    }
  }
  ```

  The relaxed-json people have an online playground here I've found helpful:
  http://www.relaxedjson.org/docs/converter.html

* The main Jexi command is simply `jexi`.

  Note: if not npm installing globally, do "npm link" in the root jexi directory prior to doing "npm install" to get the `jexi` command. 

  I've saved a few examples here in the relaxed-json format as `.jexi` files alongside their equivalent `.json` versions.

  Using jexi you can run those from the command line e.g.

  ```
  $ jexi examples/factorial.jexi 
  factorial 5 is: 120
  factorial 40 is: 8.159152832478977e+47
  ```

* If you run Jexi without any arguments it will start a repl:

  ```
  $ jexi
  Starting Jexi REPL...
  jexi> 
  ```

  When in the repl you can run examples using `$run` e.g.

  ```
  $ jexi
  Starting Jexi REPL...
  jexi> { $run: examples/factorial.jexi }
  factorial 5 is: 120
  factorial 40 is: 8.159152832478977e+47
  undefined
  jexi> 
  ```

  A couple other things you can do in the repl are:

  - to load a file (and not run it) do:
  
    `{$load: path/to/file.jexi}`

  - to see the current environment variables do:

    `$env`

  - to see the global environment (e.g. the built-in functions) do:

    `$globals`

  - to enable tracing of the Jexi interpreter type:

    `{ $set: { $options.trace: true } }`

Here's a an example of a little repl session loading the factorial example and then copy/pasting parts to eval:

  ```
  $ jexi
  Starting Jexi REPL...
  jexi> {$load: examples/factorial.jexi}
  undefined
  jexi> $env
  {
    factorial: {
      '$do': [
        {
          '$function': {
            name: '$factorial',
            args: [ '$n' ],
            do: {
              '$if': {
                cond: { '$==': [ '$n', 0 ] },
                then: 1,
                else: {
                  '$*': [
                    '$n',
                    { '$factorial': { '$-': [ '$n', 1 ] } }
                  ]
                }
              }
            }
          }
        },
        { '$console.log': [ 'factorial 5 is:', { '$factorial': 5 } ] },
        { '$console.log': [ 'factorial 40 is:', { '$factorial': 40 } ] }
      ]
    }
  }
  jexi> {
  ...         '$function': {
  ...           name: '$factorial',
  ...           args: [ '$n' ],
  ...           do: {
  ...             '$if': {
  ...               cond: { '$==': [ '$n', 0 ] },
  ...               then: 1,
  ...               else: {
  ...                 '$*': [
  ...                   '$n',
  ...                   { '$factorial': { '$-': [ '$n', 1 ] } }
  ...                 ]
  ...               }
  ...             }
  ...           }
  ...         }
  ...       }
  undefined
  jexi> $env
  { factorial: [AsyncFunction: lambda] { _handler: true } }
  jexi> { '$factorial': 5 }
  120
  jexi> { '$console.log': [ 'factorial 40 is:', { '$factorial': 40 } ] }
  factorial 40 is: 8.159152832478977e+47
  undefined
  jexi> 
  (To exit, press Ctrl+C again or Ctrl+D or type .exit)
  ```

* NOTE:  there seemed to be an issue with $fetch as implemented here under v16 versions of node.js after v16.19.0.  It appears resolved in v18+.
