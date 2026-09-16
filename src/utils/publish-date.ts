/**
 * Publish-date helper.
 *
 * `publishedAt` is a Draft & Publish managed timestamp: the REST content API
 * strips it from update payloads, and the Document Service re-stamps it with
 * the current time on every publish. Writing the column through the query
 * engine is the only way to keep an editor-chosen date, and it still fires the
 * db lifecycle hooks that queue a front-end rebuild.
 */

/** Overwrite `publishedAt` on the live version(s) of a document. */
export async function setDocumentPublishedAt(
  strapi: any,
  uid: string,
  documentId: string,
  publishedAt: string,
): Promise<number> {
  const liveRows: Array<{ id: number }> = await strapi.db.query(uid).findMany({
    where: { documentId, publishedAt: { $notNull: true } },
    select: ['id'],
  })

  for (const row of liveRows) {
    await strapi.db.query(uid).update({
      where: { id: row.id },
      data: { publishedAt },
    })
  }

  return liveRows.length
}
