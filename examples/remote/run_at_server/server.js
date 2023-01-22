import bodyParser from 'body-parser'
import express from 'express'
import { interpreter } from '../../../src/index.js'
import jayson from 'jayson'

// imagining the server may have it's own custom commands later on:
// (e.g. "$client" to talk back to the client? maybe?)
const extensions = {}

const jexi = interpreter(extensions, { trace: false })

const app = express()

// create a plain jayson server
const server = new jayson.server({
  jexi: async (jexiForms, done) => {
console.log('GOT jexiForms:', jexiForms)
    try {
      const result = await jexi.evaluate(jexiForms)

      done(null, result)
    } catch (err) {
      done(err)
    }
  },
  echo: (theArg, done) => {
console.log('GOT theArg:', theArg)
    done(null, theArg)
  },
})

app.use(bodyParser.json())

app.use((req, res, next) => {
  const request = req.body

  // <- here we can check headers, modify the request, do logging, etc
  server.call(request, (err, response) => {
    if (err) {
      // if err is an Error, err is NOT a json-rpc error
      if (err instanceof Error) {
        return next(err)
      }

      // <- deal with json-rpc errors here, typically caused by the user
      res.status(400)
      res.send(err)

      return
    }

    // <- here we can mutate the response, set response headers, etc
    if (response) {
      res.send(response)
    } else {
      // empty response (could be a notification)
      res.status(204)
      res.send('')
    }
  })
})

// eslint-disable-next-line no-console
console.log('Starting Jexi Server...')
console.log('Listening on http://localhost:3001')
app.listen(3001)

