const {FBLogger} = require('@solidgoldpig/fb-utils-node')

const listenServer = async (app, options = {}) => {
  const {
    PORT,
    callback
  } = options
  // Fire up the app
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, (err) => {
      FBLogger(`App is running on localhost:${PORT}`)
      if (callback) {
        return callback(err, {server, app})
      }
      if (err) {
        reject(err)
      } else {
        resolve({server, app})
      }
    })
  })
}

module.exports = listenServer
