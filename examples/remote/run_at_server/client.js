// THIS EXAMPLE FROM JAYSON PROJECT
// SHOWED HOW TO INVOKE A JSON RPC
// IT USED SUPERAGENT BUT IN JEXI I'M USING CROSS-FETCH
// (LEAVING IT FOR NOW BUT I MAY JUST DELETE IT LATER)
/* eslint-disable no-console */
import jayson from 'jayson'
import request from 'superagent'

// generate a json-rpc version 2 compatible request (non-notification)
const jexiRequestBody = jayson.Utils.request('jexi', { '$*': [ 7, 8 ]}, undefined, {
  version: 2,
})

const echoRequestBody = jayson.Utils.request('echo', { for: [ 1, 2, 3, 4 ], as: '$elem' }, undefined, {
  version: 2,
})

request.post('http://localhost:3001')
  // <- here we can setup timeouts, set headers, cookies, etc
  .timeout({ response: 5000, deadline: 60000 })
  .send(jexiRequestBody)
  .end((err, response) => {
    if (err) {
      // superagent considers 300-499 status codes to be errors
      // @see http://visionmedia.github.io/superagent/#error-handling
      if (!err.status) {
        throw err
      }

      const body = err.response.body

      // body may be a JSON-RPC error, or something completely different
      // it can be handled here
      if (body && body.error && jayson.Utils.Response.isValidError(body.error, 2)) {
        // the error body was a valid JSON-RPC version 2
        // we may wish to deal with it differently
        console.err(body.error)

        return
      }

      // error was something completely different
      throw err
    }

    const body = response.body

    // check if we got a valid JSON-RPC 2.0 response
    if (!jayson.Utils.Response.isValidResponse(body, 2)) {
      console.err(body)
    }

    if (body.error) {
      // we have a json-rpc error...
      console.err(body.error)
    } else {
      // do something useful with the result
      console.log(body.result)
    }
  })

