import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as catchup from './catchup'
import * as highlineChron from './highline-chron'
import * as onlyLinks from './only-links'
import * as followingChron from './following-chron'

type AlgoHandler = (ctx: AppContext, params: QueryParams, requesterDid: string) => Promise<OutputSchema>

export const allShortnames = new Set([catchup.shortname, highlineChron.shortname, onlyLinks.shortname])

const algos: Record<string, AlgoHandler> = {
  [catchup.shortname]: <AlgoHandler>catchup.handler,
  [highlineChron.shortname]: <AlgoHandler>highlineChron.handler,
  [onlyLinks.shortname]: <AlgoHandler>onlyLinks.handler,
  [followingChron.shortname]: <AlgoHandler>followingChron.handler
}

export default algos
