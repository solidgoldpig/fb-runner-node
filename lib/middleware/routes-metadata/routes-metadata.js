/* eslint-disable require-atomic-updates */
const router = require('express').Router()
const jp = require('jsonpath')
const deepEqual = require('fast-deep-equal')

const nunjucksConfiguration = require('../nunjucks-configuration/nunjucks-configuration')
const {deepClone} = require('@solidgoldpig/fb-utils-node')

const {
  getPageInstancesHash,
  getInstance,
  getInstanceProperty
} = require('../../service-data/service-data')

const {format} = require('../../format/format')
const useAsync = require('../use-async/use-async')
const route = require('../../route/route')
const {getPagesMethods, getNavigation, getNavigationPages} = route
const {
  getUrl,
  getRedirectUrl,
  getData,
  getNextUrl,
  getPreviousUrl
} = route
const {
  skipPage,
  setComposite,
  setControlNames,
  setRepeatable,
  setMultipartForm,
  processUploads,
  setUploads,
  removeItem,
  addItem,
  processInput,
  validateInput,
  redirectNextPage,
  setFormContent,
  setDefaultValues,
  formatProperties,
  updateControlNames,
  setService,
  skipComponents,
  kludgeUpdates
} = require('../../page/page')
const {
  getInstanceController,
  getModules
} = require('../../controller/controller')

const {
  setEditorModes,
  setEditorControls
} = require('../../editor/editor')

const CONSTANTS = require('../../constants/constants')
const {
  PLATFORM_ENV,
  GA_TRACKING_ID
} = CONSTANTS

let defaultLang
const initRoutes = () => {
  const pages = getPageInstancesHash()
  route.initRoutes(pages)
  defaultLang = getInstanceProperty('service', 'languageDefault') || 'en'
}

const metadataRouter = () => {
  initRoutes()
  router.use(useAsync(pageHandler))
  return router
}

const pageHandler = async (req, res) => {
  const pagesMethods = getPagesMethods()

  let url = req._parsedUrl.pathname.replace(/\/(edit|preview|flow)$/, '')

  url = url || '/'

  let CHANGEPAGE = req.body.changepage

  let handlerData = getData(url)
  if (!handlerData && url.match(/\/change/)) {
    url = url.replace(/\/change(\/.+){0,1}$/, (m, m1) => {
      CHANGEPAGE = m1 || true
      return ''
    })
    handlerData = getData(url)
  }

  if (!handlerData) {
    return undefined
  } else {
    req.lang = handlerData.lang || defaultLang

    Object.assign(req.params, handlerData.params)
    const route = handlerData.route

    const POST = req.method === 'POST'
    const EDITMODE = req.editmode
    const params = req.params

    const userData = Object.assign({}, req.user, {
      lang: req.lang,
      contentLang: defaultLang !== req.lang ? req.lang : undefined,
      url,
      POST
    },
    // TODO: remove these since they're only used by the editor
    {
      EDITMODE,
      pagesMethods,
      getNavigation,
      getNavigationPages
    })
    userData.setParams(params)
    userData.setBodyInput(req.body)

    let pageInstance = deepClone(getInstance(route))

    const pageController = getInstanceController(pageInstance)
    const modules = getModules()

    if (pageController.setUserData) {
      pageInstance = await pageController.setUserData(pageInstance, userData)
    }

    if (pageInstance.scope) {
      userData.setScope(pageInstance.scope)
    } else {
      pageInstance.scope = 'input'
    }

    // Check whether page type needs anything run first
    if (!EDITMODE) {
      if (pageController.preFlight) {
        pageInstance = await pageController.preFlight(pageInstance, userData)
      }
    }

    const message = `Page Handler for ${pageInstance._id}: ${req.method} ${req.url}`
    userData.logger.info({
      name: 'routes-metadata-handler',
      pageInstance: pageInstance._id
    }, message)

    if (!EDITMODE) {
      if (pageInstance.inactive) {
        return undefined
      }
    }

    // DOUBLED-UP
    // if (pageInstance.scope) {
    //   userData.setScope(pageInstance.scope)
    // } else {
    //   pageInstance.scope = 'input'
    // }

    if (pageInstance.allowQueryParams) {
      pageInstance.allowQueryParams.forEach(query => {
        const queryParam = req.params[query]
        if (queryParam !== undefined) {
          userData.setUserDataProperty(query, queryParam)
        }
      })
    }

    pageInstance.url = url
    if (pageInstance.namePrefix) {
      const namePrefix = format(pageInstance.namePrefix, req.params, {markdown: false})
      pageInstance.namePrefix = namePrefix
    }
    pageInstance.contentLang = userData.contentLang

    const nextUrl = getNextUrl({_id: route, params}, userData)
    if (nextUrl) {
      pageInstance.nextpage = nextUrl
    }
    const previousUrl = getPreviousUrl({_id: route, params}, userData)
    if (previousUrl) {
      pageInstance.previouspage = previousUrl
    }

    if (pageInstance.skip) {
      return res.redirect(pageInstance.nextpage)
    }

    const getServiceUrl = (lang) => {
      let serviceUrl
      if (lang) {
        const langServiceUrl = `SERVICE_URL_${lang.toUpperCase()}`
        serviceUrl = CONSTANTS[langServiceUrl]
      }
      if (!serviceUrl) {
        serviceUrl = CONSTANTS.SERVICE_URL
      }
      return serviceUrl
    }

    if (pageInstance._id === 'page.start') {
      const serviceUrl = getServiceUrl(userData.contentLang)
      if (serviceUrl) {
        const referrer = req.get('Referrer') || ''
        const referrerCheck = referrer.replace(/^(https{0,1}:\/\/[^/]+)\/.*/, '$1')
        const serviceUrlCheck = serviceUrl.replace(/^(https{0,1}:\/\/[^/]+)\/.*/, '$1')
        if (referrerCheck !== serviceUrlCheck) {
          return res.redirect(serviceUrl)
        } else {
          return res.redirect(pageInstance.nextpage)
        }
      }
    }

    if (!EDITMODE) {
      if (req.newSession && pageInstance.previouspage) {
        const startPageUrl = getServiceUrl(userData.contentLang) || getUrl('page.start', {}, userData.contentLang)
        return res.redirect(startPageUrl)
      }
    }

    pageInstance = await setEditorModes(pageInstance, userData)

    if (CHANGEPAGE) {
      pageInstance.changepage = CHANGEPAGE
    }

    // pageController and preflight used to be here

    // Check whether page should be displayed
    if (!EDITMODE) {
      pageInstance = skipPage(pageInstance, userData)
      if (pageController.skipPage) {
        pageInstance = await pageController.skipPage(pageInstance, userData)
      }
      if (pageInstance.redirect) {
        await userData.saveData()
        return res.redirect(pageInstance.redirect)
      }
    }

    if (pageController.setContents) {
      pageInstance = pageController.setContents(pageInstance, userData, res)
    }

    pageInstance = setControlNames(pageInstance, userData)
    pageInstance = setRepeatable(pageInstance, userData, EDITMODE === 'edit')
    pageInstance = setComposite(pageInstance, userData)

    // Remove unneeded components
    if (EDITMODE !== 'edit' && EDITMODE !== 'preview') {
      pageInstance = skipComponents(pageInstance, userData)
    }

    // Handle multi-part forms and uploads
    pageInstance = await setMultipartForm(pageInstance, userData)
    if (pageInstance.encType) {
      if (req.method === 'POST') {
        pageInstance = await processUploads(pageInstance, userData)
      }
      pageInstance = await setUploads(pageInstance, userData)
    }

    if (POST) {
      // handle inbound values
      pageInstance = processInput(pageInstance, userData)

      const redirectToSelf = async () => {
        await userData.saveData()
        return res.redirect(getRedirectUrl(pageInstance.url, pageInstance.changepage))
      }

      // remove items
      pageInstance = await removeItem(pageInstance, userData)
      if (pageInstance.redirectToSelf) {
        return redirectToSelf()
      }

      // add another item
      pageInstance = await addItem(pageInstance, userData)
      if (pageInstance.redirectToSelf) {
        return redirectToSelf()
      }

      const {addFile, removeFile, removeSlot, setupReturn} = userData.getBodyInput()
      const skipValidation = addFile || removeFile || removeSlot || setupReturn
      if (!skipValidation) {
        // validate inbound values
        pageInstance = validateInput(pageInstance, userData)
        // run any post validation code
        if (pageController.postValidation) {
          pageInstance = await pageController.postValidation(pageInstance, userData)
          if (pageInstance.redirect) {
            return res.redirect(pageInstance.redirect)
          }
        }
      }

      // VERBOSE x 3 - and why not before validation?
      await userData.saveData()
      if (setupReturn) {
        const setupReturnUrl = getUrl('return.setup', {}, userData.contentLang)
        return res.redirect(setupReturnUrl)
      }

      // go to next page if valid
      if (!EDITMODE) {
        pageInstance = await redirectNextPage(pageInstance, userData)
        if (pageInstance.redirect) {
          const redirectUrl = getUrl(pageInstance.redirect, {}, userData.contentLang)
          return res.redirect(redirectUrl)
        }
      }
    }

    // TODO: can this move before setupReturn and avoid repeated redirect code
    if (pageController.preUpdateContents) {
      pageInstance = await pageController.preUpdateContents(pageInstance, userData)

      await userData.saveData()

      // maybe an idea to make saveData check current data against previously saved
      if (pageInstance.redirect) {
        const redirectUrl = getUrl(pageInstance.redirect, {}, userData.contentLang)
        return res.redirect(redirectUrl)
      }
    }

    const componentInstances = jp.query(pageInstance, '$..[?(@._type)]')
    for await (const componentInstance of componentInstances) {
      const componentInstanceController = getInstanceController(componentInstance)
      if (componentInstanceController.preUpdateContents) {
        await componentInstanceController.preUpdateContents(componentInstance, userData, pageInstance)
      }
    }

    pageInstance = setFormContent(pageInstance, userData)

    pageInstance = setService(pageInstance, userData)

    // Remove unneeded components
    if (EDITMODE !== 'edit' && EDITMODE !== 'preview') {
      pageInstance = skipComponents(pageInstance, userData)
    }

    // Set default values
    pageInstance = setDefaultValues(pageInstance, userData)

    // Update name values
    pageInstance = updateControlNames(pageInstance, userData)

    // Format all the properties which need to be
    pageInstance = formatProperties(pageInstance, userData)

    // TODO: remove setContent method from fb-nunjucks-helpers
    // TODO: make this unnecessary
    pageInstance = kludgeUpdates(pageInstance, userData)

    // deal with any flash messages
    const flashMessages = userData.getFlashMessages()
    if (flashMessages && flashMessages.length) {
      pageInstance.flashMessages = flashMessages
      userData.clearFlashMessages()
      await userData.saveData()
    }

    // update visited records
    if (pageInstance.previouspage && userData.getScope() === 'input') {
      const params = userData.getUserParams()
      let visitedPages = userData.getUserDataProperty('visited', [], 'visited')

      visitedPages = visitedPages.filter(visited => {
        if (visited._id !== pageInstance._id) {
          return true
        }
        return !deepEqual(params, visited.params)
      })

      visitedPages.push({
        _id: pageInstance._id,
        params,
        url
      })

      userData.setUserDataProperty('visited', visitedPages, 'visited')
      userData.setUserDataProperty('last', url, 'visited')

      await userData.saveData()
    }

    // Editor-specific control updates
    // TODO - move to editor
    pageInstance = await setEditorControls(pageInstance, userData)

    if (pageController.preRender) {
      pageInstance = await pageController.preRender(pageInstance, userData)
    }

    for (const [key, {preRender}] of Object.entries(modules)) {
      if (preRender) {
        pageInstance = await modules[key].preRender(pageInstance, userData)
      }
    }

    // Pass userdata to context
    const userdata = userData.getUserData()
    const _scopes = userData.getScopedUserData()._scopes
    const context = {GA_TRACKING_ID, userdata, _scopes, req}
    // render with Nunjucks
    await renderPage(res, pageInstance, context)
  }
}

const renderPage = async (res, pageInstance, context) => {
  try {
    const output = await nunjucksConfiguration.renderPage(pageInstance, Object.assign({
      htmlLang: pageInstance.contentLang
    }, res.locals, context))
    return res.send(output)
  } catch (err) {
    if (PLATFORM_ENV) {
      // TODO: send error to alertmanager
      throw new Error(404)
    } else {
      return nunjucksConfiguration.debugError(err)
    }
  }
}

// initRoutes, pageHandler and renderPage needed for editor
module.exports = {
  init: metadataRouter,
  initRoutes,
  pageHandler,
  renderPage
}
