const path = require('path')
const fs = require('fs')
const jp = require('jsonpath')
const mkdirp = require('mkdirp')
const writeFileAtomic = require('write-file-atomic')
const get = require('lodash.get')
const set = require('lodash.set')
const sortKeys = require('sort-keys')
const replace = require('replace-in-file')

const {FBError, deepClone} = require('@solidgoldpig/fb-utils-node')

const {getRuntimeData} = require('@solidgoldpig/fb-runtime-node')

class FBServiceDataError extends FBError {
  constructor (error = {}) {
    super({
      error
    })
  }
}

let timestamp
let serviceInstances = {}
let sourceInstances = {}
let serviceSchemas = {}
let serviceSources = []

const external = {}

external.getRuntimeData = getRuntimeData

external.loadServiceData = async () => {
  const sourceObjs = external.getServiceSources()
  const schemas = external.getServiceSchemas()

  // temporary kludge to ensure renamed models are handled
  if (schemas['definition.namespace']) {
    process.stdout.write('Updating models to namespace if needed\n')
    const servicePath = sourceObjs
      .filter(sourceObj => sourceObj.source === 'service')
      .map(sourceObj => sourceObj.path)[0]

    try {
      const files = [`${servicePath}/**/*.json`]
      replace.sync({
        files,
        from: /"model":/g,
        to: '"namespace":'
      })
      replace.sync({
        files,
        from: /"model_auto__/g,
        to: '"namespace_auto__'
      })
    } catch (e) {
      process.stdout.write('Failed to update model to namespace\n')
    }
  } else if (schemas['definition.model']) {
    process.stdout.write('Leaving model properties alone and exiting\n')
    process.exit()
  }

  const serviceData = await external.getRuntimeData(sourceObjs, schemas)
  await external.setServiceInstances(serviceData)
  return serviceData
}

external.getTimestamp = () => timestamp

external.setServiceSchemas = (schemas) => {
  if (!Object.isFrozen(serviceSchemas)) {
    serviceSchemas = schemas
    Object.freeze(serviceSchemas)
  } else {
    throw new FBServiceDataError({
      code: 'ESERVICESCHEMASFROZEN',
      message: 'Attempt to set frozen service schemas'
    })
  }
}

external.getServiceSchemas = () => serviceSchemas

external.getServiceSchema = (name) => external.getServiceSchemas()[name]

external.getSchemaCategories = () => {
  const schemaCategories = {}
  const schemas = external.getServiceSchemas()
  Object.keys(schemas).forEach(sch => {
    if (sch.startsWith('definition.')) {
      return
    }
    if (schemas[sch].category) {
      schemas[sch].category.forEach(cat => {
        if (cat === 'definition') {
          return
        }
        schemaCategories[cat] = schemaCategories[cat] || []
        schemaCategories[cat].push(sch)
      })
    }
  })
  Object.keys(schemaCategories).forEach(category => {
    schemaCategories[category].sort()
  })
  return schemaCategories
}

external.getSchemaNameByCategory = (category) => {
  return external.getSchemaCategories()[category] || []
}
external.getSchemaProperties = (schemaName) => {
  const schema = external.getServiceSchema(schemaName)
  return Object.keys(schema.properties || {})
}
external.getSchemaNestableProperties = (schemaName) => {
  const schema = external.getServiceSchema(schemaName)
  if (!schema) {
    return []
  }
  const schemaProperties = schema.properties
  const nestableProperties = Object.keys(schemaProperties)
    .filter(property => property !== 'nextPage')
    .map(property => {
      const required = schema.required && schema.required.includes(property)

      const schemaProperty = schemaProperties[property]

      if (schemaProperty.items && schemaProperty.items._name) {
        let title = schemaProperty.items.title || schemaProperty.title
        title = title.replace(/ definition/, '')
        return Object.assign({}, schemaProperty, {
          title,
          property,
          required
        })
      } else if (schemaProperty._name) {
        return {property, required}
      }
    }).filter(value => value)
  return nestableProperties
}
external.getSchemaPropertyAllowableTypes = (schemaName, property) => {
  let itemsName = []
  const schema = external.getServiceSchema(schemaName)
  const schemaItems = get(schema, `properties["${property}"].items`)
  if (schemaItems && schemaItems._name) {
    itemsName = [schemaItems._name]
  }
  // else if (Array.isArray(schemaItems)) {
  //   itemsName = schemaItems.map(schemaItem => schemaItem._name)
  // }
  let allowables = []
  const accepts = get(schema, `properties["${property}"].accepts`)
  itemsName.forEach(itemName => {
    if (itemName.startsWith('definition.')) {
      allowables.push(...external.getSchemaNameByCategory(itemName.replace(/^definition\./, '')))
    } else {
      allowables.push(itemName)
    }
  })
  if (accepts) {
    allowables = allowables.filter(allowableName => {
      const allowableSchema = external.getServiceSchema(allowableName)
      const allowableCategory = allowableSchema.category || []
      for (let index = 0; index < accepts.length; index++) {
        if (allowableCategory.includes(accepts[index])) {
          return true
        }
      }
    })
  }
  return allowables
}

external.setServiceSources = (sourceObjs) => {
  if (!Object.isFrozen(serviceSources)) {
    serviceSources = sourceObjs
    Object.freeze(serviceSources)
  } else {
    throw new FBServiceDataError({
      code: 'ESERVICESOURCESFROZEN',
      message: 'Attempt to set frozen service sources'
    })
  }
}

external.getServiceSources = () => serviceSources

external.getSourcePath = (source) => {
  const sourceObj = external.getServiceSources().filter(sourceObj => sourceObj.source === source)
  if (sourceObj[0]) {
    return sourceObj[0].path
  }
}

external.setSourceInstances = (data) => {
  sourceInstances = data
}

external.getSourceInstances = () => {
  return sourceInstances
}

external.setServiceInstances = (instances, freeze) => {
  if (!Object.isFrozen(serviceInstances)) {
    serviceInstances = deepClone(instances)
    instances.sourceInstances = instances.sourceInstances || {}
    external.setSourceInstances(instances.sourceInstances.data)
    timestamp = Date.now().toString()
  } else {
    throw new FBServiceDataError({
      code: 'ESERVICEDATAFROZEN',
      message: 'Attempt to set frozen service data'
    })
  }
  if (freeze) {
    Object.freeze(serviceInstances)
  }
  return serviceInstances
}

external.getServiceInstances = () => {
  return serviceInstances
}

external.getInstance = (id, defaultValue) => {
  let instance = external.getServiceInstances()[id]
  if (!instance) {
    instance = jp.query(external.getServiceInstances(), `$..[?(@._id === "${id}")]`)[0] || defaultValue
  }
  return instance ? deepClone(instance) : undefined
}

external.getString = (_id, lang, defaultValue) => {
  // TODO: pass through formatting args (_id, lang, defaultValue, formatArgs) and format string
  return external.getInstanceLangProperty(_id, 'value', lang, defaultValue)
}

external.getDiscreteInstance = (id) => {
  const topLevelInstance = external.getServiceInstances()[id]
  if (topLevelInstance) {
    return topLevelInstance
  }

  const allPaths = jp.paths(external.getServiceInstances(), `$..[?(@._id === "${id}")]`)

  for (const paths of allPaths) {
    const toplevelId = paths[1]
    const potentialInstance = external.getInstance(toplevelId)
    if (!potentialInstance) {
      break
    }
    const potentialSourceInstance = external.getSourceInstance(potentialInstance._id, potentialInstance.$source)
    if (!potentialSourceInstance) {
      break
    }
    const containsId = jp.query(potentialSourceInstance, `$..[?(@._id === "${id}")]`)[0]
    if (containsId) {
      return external.getInstance(toplevelId)
    }
  }
}

external.getInstanceProperty = (id, property, defaultValue) => {
  const instance = external.getInstance(id) || {}
  if (Array.isArray(property)) {
    for (let i = 0, propLength = property.length; i < propLength; i++) {
      const propDefaultValue = i === propLength - 1 ? defaultValue : undefined
      const propValue = get(instance, property[i], propDefaultValue)
      if (propValue !== undefined) {
        return propValue
      }
    }
    return
  }
  return get(instance, property, defaultValue)
}

external.getInstanceLangProperty = (id, property, lang, defaultValue) => {
  const properties = [property]
  if (lang) {
    properties.unshift(`${property}:${lang}`)
  }
  return external.getInstanceProperty(id, properties, defaultValue)
}

external.getInstancesByProperty = (property) => {
  const instances = external.getServiceInstances()
  return jp.query(instances, `$..[?(@.${property} && @.$source)]`)
}

external.getInstancesByPropertyValue = (property, value, ignoreSource) => {
  const instances = external.getServiceInstances()
  if (typeof value === 'string') {
    value = `"${value}"`
  }
  const sourceLookup = ignoreSource ? '' : ' && @.$source'
  const matchedInstances = jp.query(instances, `$..[?(@.${property} === ${value}${sourceLookup})]`)
  return matchedInstances
}

external.getInstanceByPropertyValue = (property, value) => {
  return external.getInstancesByPropertyValue(property, value)[0]
}

external.getInstanceIdByPropertyValue = (property, value) => {
  const instance = external.getInstancesByPropertyValue(property, value, true)[0] || {}
  return instance._id
}

external.getInstanceTitle = (_id, isSummary = false) => {
  const instance = external.getInstance(_id)

  if (!instance) {
    return
  }

  let title

  if (isSummary) {
    title = instance.headingSummary || instance.legendSummary || instance.labelSummary || instance.textSummary
  }

  if (!title) {
    title = instance.title || instance.heading || instance.legend || instance.label || instance.text
  }

  if (!title && instance._type === 'page.singlequestion') {
    if (instance.components && instance.components[0]) {
      const firstComponent = instance.components[0]
      title = firstComponent.legend || firstComponent.label
    }
  }
  return title || _id
}

external.isPage = (instance) => {
  return instance._type && instance._type.startsWith('page.')
}

external.getInstanceTitleSummary = (_id) => {
  return external.getInstanceTitle(_id, true)
}

external.getPageInstances = () => {
  const serviceInstances = external.getServiceInstances()
  const pages = Object.keys(serviceInstances).map(_id => serviceInstances[_id])
    .filter(instance => external.isPage(instance))
  return pages
}

external.getPageInstancesHash = () => {
  const pageList = external.getPageInstances()
  const pages = {}
  pageList.forEach(instance => {
    pages[instance._id] = instance
  })
  return pages
}

external.getEntryPointInstances = () => {
  const pages = external.getPageInstances()
    .filter(instance => !instance._parent)
  return pages
}

external.getInstancePathPrefix = (type) => {
  if (type.startsWith('page.')) {
    return 'page'
  } else if (type.startsWith('config')) {
    return 'config'
  } else if (type.startsWith('string') || type.startsWith('strings')) {
    return 'string'
  } else if (type.startsWith('filetype') || type.startsWith('classname')) {
    return 'data'
  } else {
    return 'component'
  }
}

external.writeFileAtomic = (instancePath, instance, errFn, fn) => {
  const instanceJSON = JSON.stringify(sortKeys(instance, {deep: true}), null, 2)
  writeFileAtomic(instancePath, instanceJSON, (err) => {
    if (err) {
      errFn(err)
    } else {
      fn(true)
    }
  })
}

external.ensureInstanceDirectory = (instanceDirPath) => {
  mkdirp.sync(instanceDirPath)
}

const saveInstance = (sourcePath, instance) => {
  const pathPrefix = external.getInstancePathPrefix(instance._type)
  const instanceDirPath = path.join(sourcePath, pathPrefix)
  external.ensureInstanceDirectory(instanceDirPath)
  const instancePath = path.join(instanceDirPath, `${instance._id}.json`)
  // TODO: Ensure that instancePath actually exists
  return new Promise((resolve, reject) => {
    external.writeFileAtomic(instancePath, instance, reject, resolve)
  })
}

external.deleteFile = (instancePath, errFn, fn) => {
  fs.unlink(instancePath, (err) => {
    if (err) {
      errFn(err)
    } else {
      fn(true)
    }
  })
}

external.deleteInstance = (_id) => {
  const discreteInstance = external.getDiscreteInstance(_id)
  if (discreteInstance._id === _id) {
    return external.deleteDiscreteInstance(_id)
  } else {
    return external.deleteNestedInstance(_id)
  }
}

external.deleteNestedInstance = (_id) => {
  const discreteInstance = external.getDiscreteInstance(_id)
  if (discreteInstance._id === _id) {
    return throwRejectedPromise({
      code: 'EDELETENONNESTEDINSTANCE',
      message: 'Not a nested instance'
    })
  }
  let propertyValue
  const parentPath = jp.paths(discreteInstance, `$..[?(@._id === "${_id}")]`)[0]
  const parentPathLast = parentPath[parentPath.length - 1]
  if (Number.isInteger(parentPathLast)) {
    const index = parentPath.pop()
    const propertyValuePath = jp.stringify(parentPath)
    propertyValue = jp.query(discreteInstance, propertyValuePath)[0]
    propertyValue.splice(index, 1)
    if (!propertyValue.length) {
      propertyValue = undefined
    }
  }
  const property = parentPath.pop()
  let propertyInstance = discreteInstance
  const propertyInstancePath = jp.stringify(parentPath)
  if (propertyInstancePath !== '$') {
    propertyInstance = jp.query(discreteInstance, propertyInstancePath)[0]
  }
  return external.setInstanceProperty(propertyInstance._id, property, propertyValue)
}

external.deleteDiscreteInstance = async (_id) => {
  const discreteInstance = external.getDiscreteInstance(_id)
  if (discreteInstance._id !== _id) {
    return throwRejectedPromise({
      code: 'EDELETENONDISCRETEINSTANCE',
      message: 'Not a top-level instance'
    })
  }
  if (discreteInstance.$source !== 'service') {
    return throwRejectedPromise({
      code: 'EDELETENONSERVICEINSTANCE',
      message: 'Instance is not a service instance'
    })
  }
  const sourcePath = external.getSourcePath('service')
  const _type = external.getInstanceProperty(_id, '_type')
  const pathPrefix = external.getInstancePathPrefix(_type)
  const instancePath = path.join(sourcePath, pathPrefix, `${_id}.json`)

  // NB. same should be done for components, conditionalComponent, _isa etc
  const stepInstances = external.getInstancesByProperty('steps')
    .filter(instance => {
      return instance.steps.includes(_id)
    })
  await Promise.all(stepInstances.map((stepInstance) => {
    const steps = stepInstance.steps
    const index = steps.indexOf(_id)
    steps.splice(index, 1)
    return external.setInstanceProperty(stepInstance._id, 'steps', steps)
  }))

  // TODO: Ensure that instancePath actually exists
  return new Promise((resolve, reject) => {
    external.deleteFile(instancePath, reject, resolve)
  })
}

const throwRejectedPromise = (error) => {
  return Promise.reject(new FBServiceDataError({error}))
}

external.setInstance = (instance) => {
  const {_id: id} = instance
  if (!id) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEMISSINGID',
      message: 'No id passed for instance'
    })
  }
  if (!instance._type) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEMISSINGTYPE',
      message: `Instance ‘${id}’ has no type`
    })
  }
  const discreteInstance = external.getDiscreteInstance(id)
  if (!discreteInstance) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEINSTANCENOTFOUND',
      message: `Instance ‘${id}’ not found`
    })
  }
  // NB. this is hard-coded to ensure no writing of data into modules
  // TODO: consider if $source is necessary at all in this part of the dance
  const source = discreteInstance.$source ? 'service' : undefined
  if (!source) {
    return throwRejectedPromise({
      code: 'ESETINSTANCENOSOURCE',
      message: `Instance ‘${id}’ has no source`
    })
  }
  const sourcePath = external.getSourcePath(source)
  if (!sourcePath) {
    return throwRejectedPromise({
      code: 'ESETINSTANCESOURCENOTFOUND',
      message: `Source specified for instance ‘${id}’ does not exist`
    })
  }

  let instanceOut = instance
  if (id !== discreteInstance._id) {
    const sourceDiscreteInstance = deepClone(external.getSourceDiscreteInstance(id, discreteInstance.$source))
    jp.apply(sourceDiscreteInstance, `$..[?(@._id === "${id}")]`, value => instanceOut)
    instanceOut = sourceDiscreteInstance
  }

  return saveInstance(sourcePath, instanceOut)
}

external.setInstanceProperty = (id, property, value) => {
  if (typeof id === 'object') {
    id = id._id
  }
  if (!id) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEPROPERTYMISSINGID',
      message: 'No id passed to setInstanceProperty'
    })
  }
  if (!property) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEPROPERTYMISSINGPROPERTY',
      message: `No property for instance ‘${id}’ passed to setInstanceProperty`
    })
  }
  const protectedProperties = [
    '_id',
    '_type'
  ]
  if (protectedProperties.includes(property)) {
    return throwRejectedPromise({
      code: 'ESETINSTANCEPROPERTYPROTECTED',
      message: `Property ‘${property}’ for instance ‘${id}’ is protected`
    })
  }
  const instance = external.getDiscreteInstance(id)
  let newInstance = external.getSourceInstance(id, instance.$source)
  const oldProp = newInstance[property]
  set(newInstance, property, value)
  if (property === 'name' || property === 'value') {
    const updatePropertyReferences = (propName, query, applyFn) => {
      const allInstances = external.getServiceInstances()
      const updateIdentifier = (instId) => {
        let inst = instId
        if (typeof inst === 'string') {
          inst = allInstances[instId]
          inst = external.getSourceInstance(instId, inst.$source)
        }
        jp.apply(inst, query, applyFn)
        return inst
      }
      newInstance = updateIdentifier(newInstance)
      const idsWithRefs = Object.keys(allInstances).filter(instId => {
        if (instId === 'sourceInstances') {
          return
        }
        if (instId === newInstance._id) {
          return
        }
        let inst = allInstances[instId]
        inst = external.getSourceInstance(instId, inst.$source)
        return jp.query(inst, query).length
      }).map(instId => updateIdentifier(instId))

      if (idsWithRefs.length) {
        const updatePromises = Promise.all(idsWithRefs.map(inst => external.setInstance(inst)))
        return updatePromises
          .then(() => external.setInstance(newInstance))
      }
    }

    let nameForValue = ''
    if (property === 'value') {
      const namePath = jp.paths(instance, `$..[?(@._id === "${id}")]`)[0]
      if (namePath) {
        namePath.length = namePath.length - 2
        const nameElement = jp.query(instance, jp.stringify(namePath))[0]
        nameForValue = nameElement.name
      }
    }
    const refQueryBundles = {
      name: {
        query: `$..[?(@.identifier === "${oldProp}")]`,
        applyFn: (condition) => {
          condition.identifier = value
          return condition
        }
      },
      value: {
        query: `$..[?(@.value ==="${oldProp}" && @.identifier === "${nameForValue}")]`,
        applyFn: (condition) => {
          condition.value = value
          return condition
        }
      }
    }
    const {query, applyFn} = refQueryBundles[property]
    const updatePromise = updatePropertyReferences(property, query, applyFn)
    if (updatePromise) {
      return updatePromise
    }
  }
  if (property === 'repeatable' && value) {
    if (!newInstance.namespace) {
      if (newInstance._type.match(/^(page\.|fieldset|group)/)) {
        let namespaceSeed = 'namespace_auto__1'
        let namespaceSeedCheck = true
        while (namespaceSeedCheck) {
          if (external.getInstanceIdByPropertyValue('namespace', namespaceSeed)) {
            namespaceSeed = namespaceSeed.replace(/_(\d+)$/, (m, m1) => {
              const newSuffix = m1 * 1 + 1
              return `_${newSuffix}`
            })
          } else {
            namespaceSeedCheck = false
          }
        }
        set(newInstance, 'namespace', namespaceSeed)
      }
    }
  }
  return external.setInstance(newInstance)
}

external.createInstance = (instance, options = {}) => {
  const {_id: id} = instance
  if (!id) {
    return throwRejectedPromise({
      code: 'ECREATEINSTANCEMISSINGID',
      message: 'No id passed for instance'
    })
  }
  if (!instance._type) {
    return throwRejectedPromise({
      code: 'ECREATEINSTANCEMISSINGTYPE',
      message: `Instance ‘${id}’ has no type`
    })
  }
  const existsInstance = external.getInstance(id)
  if (existsInstance) {
    return throwRejectedPromise({
      code: 'ECREATEINSTANCEINSTANCEEXISTS',
      message: `Instance ‘${id}’ already exists`
    })
  }

  let newInstance = instance
  // ensure output always written to service metadata by default
  let source = options.source || 'service'
  const outputSource = source

  const {_id: addId, property: addProperty, operation = 'push'} = options
  if (addId) {
    if (!addProperty) {
      return throwRejectedPromise({
        code: 'ECREATEINSTANCEADDNOPROPERTY',
        message: `Instance ‘${addId}’ specified to add new instance ‘${id}’ to without any property`
      })
    }
    const addInstance = external.getDiscreteInstance(addId)
    if (!addInstance) {
      return throwRejectedPromise({
        code: 'ECREATEINSTANCEADDNOTFOUND',
        message: `Instance ‘${addId}’ to add new instance ‘${id}’ to not found`
      })
    }
    source = addInstance.$source
    if (!source) {
      return throwRejectedPromise({
        code: 'ECREATEINSTANCEADDNOSOURCE',
        message: `Instance ‘${addId}’ to add new instance ‘${id}’ to has no source`
      })
    }

    const sourceDiscreteInstance = deepClone(external.getSourceDiscreteInstance(addInstance._id, source))
    const insertionPoint = jp.query({draft: sourceDiscreteInstance}, `$..[?(@._id === "${addId}")]`)[0]
    if (insertionPoint) {
      const schema = external.getServiceSchema(insertionPoint._type)
      let propertyType = 'array'
      const propertySchema = schema ? schema.properties[addProperty] : undefined
      if (propertySchema) {
        propertyType = propertySchema.type
      }
      if (propertyType === 'array') {
        insertionPoint[addProperty] = insertionPoint[addProperty] || []
        insertionPoint[addProperty][operation](deepClone(newInstance))
      } else {
        insertionPoint[addProperty] = deepClone(newInstance)
      }
    }
    newInstance = sourceDiscreteInstance
  }

  const sourcePath = external.getSourcePath(outputSource)
  if (!sourcePath) {
    return throwRejectedPromise({
      code: 'ECREATEINSTANCESOURCENOTFOUND',
      message: `Source specified for instance ‘${id}’ does not exist`
    })
  }

  return saveInstance(sourcePath, newInstance)
}

external.getSourceInstance = (id, source = 'service', defaultValue) => {
  const sourceData = external.getSourceInstances()[source]
  if (!sourceData) {
    return
  }
  const topLevelInstance = sourceData[id]
  if (topLevelInstance) {
    return topLevelInstance
  }
  return jp.query(sourceData, `$..[?(@._id === "${id}")]`)[0] || defaultValue
}

external.getSourceDiscreteInstance = (id, source = 'service') => {
  const sourceData = external.getSourceInstances()[source]
  if (!sourceData) {
    return
  }
  const topLevelInstance = sourceData[id]
  if (topLevelInstance) {
    return topLevelInstance
  }

  const allPaths = jp.paths(sourceData, `$..[?(@._id === "${id}")]`)

  for (const paths of allPaths) {
    const toplevelId = paths[1]
    const potentialInstance = external.getInstance(toplevelId)
    if (!potentialInstance) {
      break
    }
    const potentialSourceInstance = external.getSourceInstance(potentialInstance._id, potentialInstance.$source)
    if (!potentialSourceInstance) {
      break
    }
    const containsId = jp.query(potentialSourceInstance, `$..[?(@._id === "${id}")]`)[0]
    if (containsId) {
      return potentialSourceInstance
    }
  }
}

external.getSourceInstanceProperty = (id, property, source = 'service', defaultValue) => {
  const instance = external.getSourceInstance(id, source) || {}
  return get(instance, property, defaultValue)
}

external.expandInstance = (instance, addError) => {
  instance = deepClone(instance)
  if (instance._isa) {
    let [_isa, service] = instance._isa.split('=>').reverse()
    if (!service) {
      const isaDiscreteInstance = external.getDiscreteInstance(_isa)
      if (!isaDiscreteInstance) {
        addError('instance.isa.missing', 'instance')
        return instance
      }
      service = isaDiscreteInstance.$source
    }
    let isaSourceInstance = external.getSourceInstance(_isa, service)
    if (!isaSourceInstance) {
      addError('instance.isa.source.missing', 'instance')
    } else {
      isaSourceInstance = external.expandInstance(isaSourceInstance, addError)
      if (isaSourceInstance.items) {
        isaSourceInstance.items.forEach((item, index, items) => {
          items[index] = external.expandInstance(items[index], addError)
        })
      }
    }
    instance = Object.assign({}, isaSourceInstance, instance)
  }
  return instance
}

// const tempFile = {}
// external.temporaryFile = tempFile

// tempFile.getPath = (_id) => {
//   const tmpInstancePath = path.join(external.getSourcePath('service'), '.temporary', _id)
//   return tmpInstancePath
// }
// tempFile.get = (_id) => {
//   const tmpInstancePath = tempFile.getPath(_id)
//   const source = fs.readFileSync(tmpInstancePath).toString()
//   const sourceInstance = JSON.parse(source)
//   return sourceInstance
// }
// tempFile.set = (_id, data) => {
//   const tmpInstancePath = tempFile.getPath(_id)
//   const error = fs.writeFileSync(tmpInstancePath, JSON.stringify(data, null, 2))
//   return new Promise((resolve, reject) => {
//     if (error) {
//       reject(error)
//     } else {
//       resolve()
//     }
//   })
// }
// tempFile.unset = (_id) => {
//   const tmpInstancePath = tempFile.getPath(_id)
//   fs.unlinkSync(tmpInstancePath)
// }

external.freeze = () => {
  Object.freeze(external)
}

module.exports = external
