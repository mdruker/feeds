import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { handleCatchupFeed } from './catchup-common'

// max 15 chars
export const shortname = 'catchup'

export const handler = async (ctx: AppContext, params: QueryParams, requesterDid: string) => {
  return await handleCatchupFeed(ctx, requesterDid, params, shortname)
}
