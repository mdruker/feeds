import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'
import { AtpAgent } from '@atproto/api'
import { isRelationship } from '@atproto/api/dist/client/types/app/bsky/graph/defs'
import { generateCatchupFeed } from './catchup-common'

// max 15 chars
export const shortname = 'catchup-all'

export const handler = async (ctx: AppContext,  params: QueryParams, requesterDid: string) => {
  return await generateCatchupFeed(ctx, requesterDid, params, false)
}