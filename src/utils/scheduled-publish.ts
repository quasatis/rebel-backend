/**
 * Scheduled publishing for Draft & Publish content types.
 *
 * Editors set `scheduledPublishAt` on a draft; a cron task publishes the
 * document once that time has passed and stamps `publishedAt` with the
 * scheduled time so the public site shows the intended date.
 */
import { setDocumentPublishedAt } from './publish-date'

/** Content types that expose a `scheduledPublishAt` attribute. */
export const SCHEDULED_PUBLISH_UIDS = ['api::article.article'] as const

const BATCH_LIMIT = 50

type ScheduledRow = {
  documentId?: string
  scheduledPublishAt?: string | Date | null
}

/**
 * Clear the schedule on every version of a document.
 *
 * Goes through the query engine rather than the Document Service, because a
 * Document Service update on the published version re-publishes it and resets
 * `publishedAt` to the current time.
 */
async function clearSchedule(strapi: any, uid: string, documentId: string) {
  const rows: Array<{ id: number }> = await strapi.db.query(uid).findMany({
    where: { documentId },
    select: ['id'],
  })

  for (const row of rows) {
    await strapi.db.query(uid).update({
      where: { id: row.id },
      data: { scheduledPublishAt: null },
    })
  }
}

/** Publish any due drafts for one content type. Returns how many went live. */
export async function publishDueDocuments(strapi: any, uid: string): Promise<number> {
  const contentType = strapi.contentTypes?.[uid]
  if (!contentType?.options?.draftAndPublish) return 0
  if (!contentType.attributes?.scheduledPublishAt) return 0

  const now = new Date()

  const due: ScheduledRow[] = await strapi.documents(uid).findMany({
    status: 'draft',
    filters: {
      scheduledPublishAt: { $notNull: true, $lte: now.toISOString() },
    },
    fields: ['documentId', 'scheduledPublishAt'],
    limit: BATCH_LIMIT,
  })

  if (!due?.length) return 0

  let published = 0

  for (const row of due) {
    const documentId = String(row.documentId || '')
    if (!documentId) continue

    try {
      // A live version means an editor scheduled an already-published doc;
      // drop the stale schedule instead of republishing it.
      const live = await strapi.documents(uid).findOne({
        documentId,
        status: 'published',
        fields: ['documentId'],
      })
      if (live) {
        await clearSchedule(strapi, uid, documentId)
        continue
      }

      const scheduledAt = row.scheduledPublishAt
        ? new Date(row.scheduledPublishAt).toISOString()
        : now.toISOString()

      await strapi.documents(uid).publish({ documentId })
      // publish() stamps publishedAt with the current time; restore the date
      // the editor picked so the public site shows it.
      await setDocumentPublishedAt(strapi, uid, documentId, scheduledAt)
      await clearSchedule(strapi, uid, documentId)

      published += 1
      strapi.log.info(`Scheduled publish: ${uid} ${documentId} went live (${scheduledAt})`)
    } catch (error) {
      strapi.log.error(
        `Scheduled publish failed for ${uid} ${documentId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      )
    }
  }

  return published
}

/** Publish due drafts across every scheduled-publish content type. */
export async function publishDueDocumentsAll(strapi: any): Promise<number> {
  let total = 0
  for (const uid of SCHEDULED_PUBLISH_UIDS) {
    total += await publishDueDocuments(strapi, uid)
  }
  return total
}
