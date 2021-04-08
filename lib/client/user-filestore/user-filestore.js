const FBUserFileStoreClient = require('@solidgoldpig/fb-user-filestore-client-node')
const metrics = require('../metrics/metrics')
const {SERVICE_SECRET, SERVICE_TOKEN, SERVICE_SLUG, USER_FILESTORE_URL} = require('../../constants/constants')

let userFileStoreClient
if (USER_FILESTORE_URL) {
  userFileStoreClient = new FBUserFileStoreClient(SERVICE_SECRET, SERVICE_TOKEN, SERVICE_SLUG, USER_FILESTORE_URL)
} else {
  userFileStoreClient = FBUserFileStoreClient.offline()
}

const {apiMetrics, requestMetrics} = metrics.getMetricsClient()
userFileStoreClient.setMetricsInstrumentation(apiMetrics, requestMetrics)

module.exports = userFileStoreClient
