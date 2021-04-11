const path = require('path')
const loadJson = require('load-json-file').sync

const {FBLogger, FBError} = require('@solidgoldpig/fb-utils-node')
class FBDependencyError extends FBError {}

const configureDependencies = (servicePackagePath, serviceNodeModulesPath) => {
  const servicePackage = loadJson(servicePackagePath)

  // Recursively determine service dependencies
  let serviceSources = []
  const versionCheck = {}
  const addDependencies = (dependencies) => {
    const deps = Object.keys(dependencies).filter(dep => dep !== 'moment')
    // TODO: moj-frontend includes moment as dependency - figure out better way to distinguish frontend packages from others
    serviceSources = serviceSources.concat(deps)
    deps.forEach(dep => {
      const depVersion = dependencies[dep]
      if (versionCheck[dep] && versionCheck[dep] !== depVersion) {
        throw new FBDependencyError(`Different versions of ${dep} found: ${depVersion} / ${versionCheck[dep]}`)
      }
      versionCheck[dep] = depVersion
      const depPackagePath = path.join(serviceNodeModulesPath, dep, 'package.json')
      const nextDeps = loadJson(depPackagePath)
      if (nextDeps.dependencies) {
        addDependencies(nextDeps.dependencies)
      }
    })
  }
  addDependencies(servicePackage.dependencies)

  // Remove duplicates
  serviceSources = [...new Set(serviceSources)]

  // Reverse order
  serviceSources = serviceSources.reverse()

  // Determine actual locations of service dependencies
  serviceSources = serviceSources.map(source => {
    const sourcePath = path.join(serviceNodeModulesPath, source)
    return {
      source,
      sourcePath
    }
  })

  // Allow dependency locations to be overridden when developing
  serviceSources = serviceSources.map(sourceObj => {
    const sourceEnvVar = `MODULE__${sourceObj.source}`.replace(/@/g, '').replace(/[-/]/g, '_')
    const sourceEnvVarValue = process.env[sourceEnvVar]
    if (sourceEnvVarValue) {
      FBLogger('Overriding components module', {sourceEnvVar, sourcePath: sourceEnvVarValue})
      sourceObj.sourcePath = sourceEnvVarValue
    }
    return sourceObj
  })

  return serviceSources
}

module.exports = configureDependencies
