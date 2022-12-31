# jexi
Jexi is all about "executable JSON"

"Jexi" stands for 'json expression interpreter'

The key ideas in Jexi are:

* Jexi embraces lisp's "code is data" philosophy except that in Jexi "code is JSON"

  (Jexi is a really lisp interpreter reimagined using JSON)

* Since JSON is language neutral the hope is that Jexi interpreters written in multiple languages might be created in the future

  (this version is in javascript and is tested in node.js and the browser)

* Since Jexi code is JSON it can be easily stored and manipulated e.g. in MongoDB, sent over the wire via api calls, etc.

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

* A repl is provided here that can be starte with:

  `npm run repl`

  The repl makes use of the "really-relaxed-json" package which allows you to omit the extra quotes on symbols to read nicer (more like JSON in a javascript file allows - in really-relaxed-json even goes further e.g. making commas optional):

  ```
  {
    $foreach: {
      in: [ 0 1 2 ]
      as: $elem
      do: {
        $console.log: $elem
      }
    }
  }
  ```

  In the repl you can snoop at the current environment by typing: `$env`

  And if you'd like to enable tracing to see what Jexi is doing you can do:

  `{ $set: { $options.trace: true } }`
