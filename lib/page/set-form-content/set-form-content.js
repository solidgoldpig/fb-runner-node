const {
  getInstance
} = require('../../service-data/service-data')
const {deepClone} = require('@solidgoldpig/fb-utils-node')

const setFormContent = (pageInstance, userData) => {
  pageInstance.actions = deepClone(getInstance('actions'))
  return pageInstance
}

module.exports = setFormContent
