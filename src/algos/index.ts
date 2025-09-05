import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as catchup from './catchup'
import * as onlyLinks from './only-links'

type AlgoHandler = (ctx: AppContext, params: QueryParams, requesterDid: string) => Promise<OutputSchema>

export const allShortnames = new Set([catchup.shortname, onlyLinks.shortname])

const algos: Record<string, AlgoHandler> = {
  [catchup.shortname]: <AlgoHandler>catchup.handler,
  [onlyLinks.shortname]: <AlgoHandler>onlyLinks.handler
}

export default algos
