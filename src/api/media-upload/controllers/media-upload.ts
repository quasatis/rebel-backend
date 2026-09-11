import _ from 'lodash'
import { errors } from '@strapi/utils'
import { sanitizeMediaFolder } from '../../../utils/media-folders'

const FILE_MODEL_UID = 'plugin::upload.file'

export default ({ strapi }) => ({
  async upload(ctx) {
    const { body, files: requestFiles } = ctx.request
    const files = requestFiles?.files

    if (_.isEmpty(files) || (!Array.isArray(files) && files.size === 0)) {
      throw new errors.ValidationError('Files are empty')
    }

    const folder = sanitizeMediaFolder(body?.path)
    const uploadService = strapi.plugin('upload').service('upload')
    const apiUploadFolder = await strapi
      .plugin('upload')
      .service('api-upload-folder')
      .getAPIUploadFolder()

    const fileInfo = Array.isArray(files)
      ? files.map(() => ({ folder: apiUploadFolder.id }))
      : { folder: apiUploadFolder.id }

    const uploadedFiles = await uploadService.upload(
      {
        data: {
          path: folder,
          fileInfo,
        },
        files,
      },
      { user: ctx.state.user },
    )

    const schema = strapi.getModel(FILE_MODEL_UID)
    ctx.body = await strapi.contentAPI.sanitize.output(uploadedFiles, schema, {
      auth: ctx.state.auth,
    })
    ctx.status = 201
  },
})
