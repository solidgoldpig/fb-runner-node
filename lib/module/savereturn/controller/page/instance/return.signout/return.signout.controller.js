const {deepClone} = require('@solidgoldpig/fb-utils-node')

const ReturnSignoutController = {}

ReturnSignoutController.preUpdateContents = async (instance, userData) => {
  const pageInstance = deepClone(instance)
  userData.clearSession()
  userData.unsetUserDataProperty('authenticated')
  userData.unsetUserDataProperty('email')

  return pageInstance
}

module.exports = ReturnSignoutController
