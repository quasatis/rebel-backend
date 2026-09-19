import { randomBytes } from 'node:crypto'

/** Opaque token embedded in campaign unsubscribe links. */
export function createUnsubscribeToken(): string {
  return randomBytes(24).toString('hex')
}
