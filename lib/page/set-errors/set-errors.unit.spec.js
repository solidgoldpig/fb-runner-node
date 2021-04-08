const test = require('tape')
const {spy, stub} = require('sinon')
const serviceData = require('../../service-data/service-data')

const {deepClone} = require('@solidgoldpig/fb-utils-node')

const setErrorsModule = require('./set-errors')
const {
  setErrors,
  setControlError,
  setControlErrors,
  setSummaryError,
  setSummaryErrors,
  setSummaryErrorsHeading,
  getFormattedError,
  adjustErrorObjs
} = setErrorsModule

test('When setErrors is required ', t => {
  t.equal(typeof setErrors, 'function', 'it should export setErrors method')
  t.equal(typeof setControlError, 'function', 'it should export setControlError method')
  t.equal(typeof setControlErrors, 'function', 'it should export setControlErrors method')
  t.equal(typeof setSummaryError, 'function', 'it should export setSummaryError method')
  t.equal(typeof setSummaryErrors, 'function', 'it should export setSummaryErrors method')
  t.equal(typeof setSummaryErrorsHeading, 'function', 'it should export setSummaryErrorsHeading method')
  t.equal(typeof getFormattedError, 'function', 'it should export getFormattedError method')
  t.end()
})

test('When adjusting error objects', t => {
  const undefinedErrors = undefined
  t.deepEqual(adjustErrorObjs({}, undefinedErrors), undefined, 'it should return undefined if passed no error objects')

  const instanceArg = [{instance: {name: 'test'}, errorType: 'boom'}]
  t.deepEqual(adjustErrorObjs({}, instanceArg), instanceArg, 'it should leave error objects with instances as they are')

  const stringInstanceArg = [{instance: 'test', errorType: 'boom'}]

  const expectedNoInstanceArg = [{instance: {}, errorType: 'boom'}]
  t.deepEqual(adjustErrorObjs({}, deepClone(stringInstanceArg)), expectedNoInstanceArg, 'it should remove instances from error objects that cannot be found in page instance')

  const page = {
    components: [{
      name: 'test'
    }]
  }
  const expectedInstanceArg = [{
    instance: {
      name: 'test'
    },
    errorType: 'boom'
  }]
  t.deepEqual(adjustErrorObjs(page, deepClone(stringInstanceArg)), expectedInstanceArg, 'it should replace strings with instances in error objects that can be found in page instance')
  t.end()
})

test('When formatting error messages', t => {
  const errorType = 'boom'
  const controlInstance = {
    _type: 'text',
    label: 'Your name'
  }
  const error = null

  const fallbackErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(fallbackErrorString, 'boom', 'it should use the errorType as the fallback value if no other error strings found')

  serviceData.setServiceInstances({
    'error.boom.azimuth': {value: 'It went boom', 'value:dry': 'Ich wa kerplunkt'}
  })

  const defaultErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(defaultErrorString, 'It went boom', 'it should use the default error message for the errorType')

  const langErrorString = getFormattedError('azimuth', controlInstance, errorType, error, 'dry')
  t.equal(langErrorString, 'Ich wa kerplunkt', 'it should use the localised error message for the errorType if lang is passed')

  serviceData.setServiceInstances({
    'error.boom.azimuth': {
      value: 'It went boom'
    },
    'error.boom.text.azimuth': {
      value: 'Text went boom'
    }
  })

  const defaultControlErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(defaultControlErrorString, 'Text went boom', 'it should use the component variant error message for the errorType')

  controlInstance.errors = {
    boom: {
      azimuth: 'Total text explosion'
    }
  }
  const controlErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(controlErrorString, 'Total text explosion', 'it should use any explicit message set by the instance')

  controlInstance.errors = {
    boom: {
      azimuth: '‘{control}’ exploded'
    }
  }
  const substitutedControlErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(substitutedControlErrorString, '‘Your name’ exploded', 'it should substitute the control’s label when requested')

  controlInstance.errors = {
    boom: {
      azimuth: ''
    }
  }
  const emptyControlErrorString = getFormattedError('azimuth', controlInstance, errorType, error)
  t.equal(emptyControlErrorString, '', 'it should return an empty string rather than trying to find the next possible value')

  t.end()
})

test('When formatting minimum and maximum messages', t => {
  const controlInstance = {
    _type: 'number',
    label: 'Days requested',
    validation: {
      minimum: 5,
      maximum: 10
    },
    errors: {
      minimum: {
        azimuth: '{value} is less than {minimum}',
        'azimuth:dry': '{value} ich minsky kao {minimum}'
      },
      exclusiveMinimum: {
        azimuth: '{value} is less than or equal to {minimum}'
      },
      maximum: {
        azimuth: '{value} is greater than {maximum}'
      },
      exclusiveMaximum: {
        azimuth: '{value} is greater than or equal to {maximum}'
      },
      type: {
        azimuth: '{errorName} is not {errorType}'
      }
    }
  }

  const minimumErrorString = getFormattedError('azimuth', controlInstance, 'minimum', {instance: 1})
  t.equal(minimumErrorString, '1 is less than 5', 'it should use the minimum error string')

  const langMinimumErrorString = getFormattedError('azimuth', controlInstance, 'minimum', {instance: 1}, 'dry')
  t.equal(langMinimumErrorString, '1 ich minsky kao 5', 'it should use the minimum error string')

  const maximumErrorString = getFormattedError('azimuth', controlInstance, 'maximum', {instance: 15})
  t.equal(maximumErrorString, '15 is greater than 10', 'it should use the maximum error string')

  controlInstance.validation.exclusiveMinimum = true
  controlInstance.validation.exclusiveMaximum = true

  const exclusiveMinimumErrorString = getFormattedError('azimuth', controlInstance, 'minimum', {instance: 1})
  t.equal(exclusiveMinimumErrorString, '1 is less than or equal to 5', 'it should use the exclusiveMinimum error string')

  const exclusiveMaximumErrorString = getFormattedError('azimuth', controlInstance, 'maximum', {instance: 15})
  t.equal(exclusiveMaximumErrorString, '15 is greater than or equal to 10', 'it should use the exclusiveMaximum error string')

  const typeErrorString = getFormattedError('azimuth', controlInstance, 'type', {name: 'type', schema: {type: 'madeupType'}})
  t.equal(typeErrorString, 'type is not madeupType', 'it should use the type error string')

  t.end()
})

test('When setting a control error', t => {
  const errorType = 'boom'
  const controlInstance = {
    _type: 'text',
    label: 'Your name'
  }
  const errorInstance = setControlError({}, controlInstance, errorType)
  t.equal(errorInstance.error, 'boom', 'it should set the instance’s error property')
  t.end()
})

test('When setting a further control error', t => {
  const errorType = 'boom'
  const controlInstance = {
    _type: 'text',
    label: 'Your name',
    error: 'Initial'
  }
  const errorInstance = setControlError({}, controlInstance, errorType)
  t.equal(errorInstance.error, 'Initial<br>boom', 'it should append the error to the instance’s error property')
  t.end()
})

test('When setting control errors', t => {
  const controlA = {
    _id: 'controlA',
    _type: 'text',
    label: 'Your name'
  }
  const controlB = {
    _id: 'controlB',
    _type: 'number',
    label: 'Your age'
  }
  const errors = [
    {
      instance: controlA,
      errorType: 'boom'
    },
    {
      instance: controlB,
      errorType: 'minimum',
      error: {
        instance: 12
      }
    }
  ]

  const setControlErrorSpy = spy(setErrorsModule, 'setControlError')
  const fakePageInstance = {
    components: [
      controlA,
      controlB
    ]
  }
  setControlErrors(fakePageInstance, errors)

  t.equal(setControlErrorSpy.callCount, 2, 'it should set the correct number of errors')

  t.deepEqual(setControlErrorSpy.getCall(0).args, [{components: [{_id: 'controlA', _type: 'text', label: 'Your name', error: 'boom'}, {_id: 'controlB', _type: 'number', label: 'Your age', error: 'minimum'}], errorsSeen: {summary: {}, control: {controlA: 'boom', controlB: 'minimum'}}}, {_id: 'controlA', _type: 'text', label: 'Your name', error: 'boom'}, 'boom', undefined], 'it should set the first error')
  t.deepEqual(setControlErrorSpy.getCall(1).args, [{components: [{_id: 'controlA', _type: 'text', label: 'Your name', error: 'boom'}, {_id: 'controlB', _type: 'number', label: 'Your age', error: 'minimum'}], errorsSeen: {summary: {}, control: {controlA: 'boom', controlB: 'minimum'}}}, {_id: 'controlB', _type: 'number', label: 'Your age', error: 'minimum'}, 'minimum', {instance: 12}], 'it should set the second error')

  setControlErrorSpy.resetHistory()

  const noErrors = []
  setControlErrors(noErrors)
  t.equal(setControlErrorSpy.callCount, 0, 'it should not set any error if there are none')
  setControlErrorSpy.restore()

  t.end()
})

const getInstanceParts = () => {
  const controlInstance = {
    _id: 'control',
    _type: 'text',
    name: 'controlname',
    label: 'Your name'
  }
  const pageInstance = {
    _type: 'page.form',
    components: [
      controlInstance
    ]
  }
  return {
    errorType: 'boom',
    controlInstance,
    pageInstance
  }
}

test('When setting a summary error', t => {
  const {pageInstance, controlInstance, errorType} = getInstanceParts()

  setSummaryError(pageInstance, controlInstance, errorType)
  t.deepEqual(pageInstance.errorList, [{
    html: 'boom',
    href: '#control'
  }], 'it should add the error to the page instance’s error list')

  t.end()
})

test('When setting a summary error for a composite field', t => {
  const {pageInstance, controlInstance, errorType} = getInstanceParts()

  setSummaryError(pageInstance, controlInstance, errorType, {compositeInput: 'rose'})
  t.deepEqual(pageInstance.errorList, [{
    html: 'boom',
    href: '#controlname-rose'
  }], 'it should add the anchor for the correct composite input field')
  t.end()
})

test('When setting a summary error for a radios field ', t => {
  const {pageInstance, controlInstance, errorType} = getInstanceParts()
  controlInstance._type = 'radios'
  controlInstance.name = 'controlname'
  controlInstance.items = []
  setSummaryError(pageInstance, controlInstance, errorType)
  t.deepEqual(pageInstance.errorList, [{
    html: 'boom',
    href: '#controlname-0'
  }], 'it should add the anchor for the first radio option element based on the radios instance name')
  t.end()
})

test('When setting a summary error for a field with items with no name', t => {
  const {pageInstance, controlInstance, errorType} = getInstanceParts()
  controlInstance._type = 'checkboxes'
  controlInstance.items = [{
    name: 'checkbox-name'
  }]
  setSummaryError(pageInstance, controlInstance, errorType)
  t.deepEqual(pageInstance.errorList, [{
    html: 'boom',
    href: '#checkbox-name'
  }], 'it should add the anchor for the first checkbox option element')
  t.end()
})

test('When adding a delimited summary error', t => {
  const xInst = {}
  setSummaryError(xInst, 'fakeinstance', 'boom==/url')
  t.deepEqual(xInst.errorList, [{
    html: 'boom',
    href: '/url'
  }], 'it should split the parts into html and text params')

  t.end()
})

test('When setting summary errors', t => {
  const pageInstance = {}
  const errors = [{
    instance: {
      _id: 'control1',
      _type: 'text',
      label: 'Your name'
    },
    errorType: 'boom'
  }, {
    instance: {
      _id: 'control2',
      _type: 'number',
      label: 'Your age'
    },
    errorType: 'minimum',
    error: {
      instance: 12
    }
  }]

  serviceData.setServiceInstances({
    'errors.summary.heading': {
      value: 'Something went wrong'
    }
  })

  const setSummaryErrorSpy = spy(setErrorsModule, 'setSummaryError')
  const setSummaryErrorsHeadingSpy = spy(setErrorsModule, 'setSummaryErrorsHeading')
  setSummaryErrors(pageInstance, errors)

  t.equal(setSummaryErrorSpy.callCount, 2, 'it should set the correct number of errors')
  const argsCheck = setSummaryErrorSpy.getCall(0).calledWith(pageInstance, errors[0].instance, errors[0].errorType, undefined) && setSummaryErrorSpy.getCall(1).calledWith(pageInstance, errors[1].instance, errors[1].errorType, errors[1].error)
  t.ok(argsCheck, 'it should set the correct errors')
  t.equal(setSummaryErrorsHeadingSpy.callCount, 1, 'it should set the summary page errors once')
  t.deepEqual(setSummaryErrorsHeadingSpy.getCall(0).args, [{errorsSeen: {summary: {control1: 'boom', control2: 'minimum'}, control: {}}, errorList: [{html: 'boom', href: '#control1'}, {html: 'minimum', href: '#control2'}], errorTitle: 'Something went wrong'}], 'it should set the page summary error heading')

  setSummaryErrorSpy.resetHistory()
  setSummaryErrorsHeadingSpy.resetHistory()

  serviceData.setServiceInstances({})
  setSummaryErrors(pageInstance, errors)
  t.equal(setSummaryErrorsHeadingSpy.callCount, 1, 'it should set the page error heading ')
  t.deepEqual(setSummaryErrorsHeadingSpy.getCall(0).args[0].errorTitle, '', 'it should set the page summary error heading if no value has been provided')

  setSummaryErrorSpy.resetHistory()
  setSummaryErrorsHeadingSpy.resetHistory()

  const noErrors = []
  setSummaryErrors(pageInstance, noErrors)
  t.equal(setSummaryErrorSpy.callCount, 0, 'it should not set any error if there are no errors')
  t.equal(setSummaryErrorsHeadingSpy.callCount, 0, 'it should not set the page error heading if there are no errors')
  setSummaryErrorSpy.restore()
  setSummaryErrorsHeadingSpy.restore()

  t.end()
})

test('When setting summary errors repeatedly', t => {
  let pageInstance = {}
  const errors = [{
    instance: {
      _id: 'control1',
      _type: 'text',
      label: 'Your name'
    },
    errorType: 'required'
  }, {
    instance: {
      _id: 'control2',
      _type: 'number',
      label: 'Your age'
    },
    errorType: 'minimum',
    error: {
      instance: 12
    }
  }]

  const errorsB = [{
    instance: {
      _id: 'control1',
      _type: 'text',
      label: 'Your name'
    },
    errorType: 'another'
  }, {
    instance: {
      _id: 'control2',
      _type: 'number',
      label: 'Your age'
    },
    errorType: 'required'
  }]

  serviceData.setServiceInstances({
    'errors.summary.heading': {
      value: 'Something went wrong'
    }
  })

  pageInstance = setErrors(pageInstance, errors)
  pageInstance = setErrors(pageInstance, errorsB)
  const errorList = pageInstance.errorList

  t.deepEqual(errorList[0], {
    html: 'required', href: '#control1'
  }, 'it should not add other errors if a required error has already been registered for the component')

  t.deepEqual(errorList[1], {
    html: 'minimum', href: '#control2'
  }, 'it should not add required errors if any error has already been registered for the component')

  t.end()
})

test('When errors have been registered out of source order', t => {
  const control1 = {
    _id: 'control1'
  }
  const control2 = {
    _id: 'control2'
  }

  let pageInstance = {
    components: [
      control1,
      control2
    ]
  }
  const errors = [{
    instance: control2,
    errorType: 'required'
  }, {
    instance: control1,
    errorType: 'invalid'
  }]

  pageInstance = setErrors(pageInstance, errors)
  const errorList = pageInstance.errorList

  t.deepEqual(errorList, [{
    html: 'invalid', href: '#control1'
  }, {
    html: 'required', href: '#control2'
  }], 'it should reorder the summary error list per source order')

  t.end()
})

test('When setting summary heading', t => {
  serviceData.setServiceInstances({
    'errors.summary.heading': {
      value: 'There {errorCount, plural, 0{were no problems} 1{was one problem} other{were {errorCount} problems}}'
    }
  })

  t.deepEqual(setSummaryErrorsHeading({errorList: [1, 2, 3]}).errorTitle, 'There were 3 problems', 'it should return the correct heading for multiple errors')
  t.deepEqual(setSummaryErrorsHeading({errorList: [1]}).errorTitle, 'There was one problem', 'it should return the correct heading for a single error')

  t.deepEqual(setSummaryErrorsHeading({errorList: []}).errorTitle, 'There were no problems', 'it should return the correct heading for no errors')

  t.end()
})

test('When setting all errors', t => {
  const errorObjs = 'errors'
  const pageInstance = 'pageInstance'

  const setControlErrorsStub = stub(setErrorsModule, 'setControlErrors')
  setControlErrorsStub.callsFake(pageInstance => pageInstance)
  const setSummaryErrorsStub = stub(setErrorsModule, 'setSummaryErrors')
  setSummaryErrorsStub.callsFake(pageInstance => pageInstance)

  setErrors(pageInstance, errorObjs)

  t.ok(setControlErrorsStub.calledOnceWithExactly(pageInstance, errorObjs), 'it should call setControlErrors with the correct args')
  t.ok(setSummaryErrorsStub.calledOnceWithExactly(pageInstance, errorObjs), 'it should call setSummaryErrors with the correct args')

  setControlErrorsStub.reset()
  setSummaryErrorsStub.reset()

  t.end()
})
