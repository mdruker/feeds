import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as catchup from './catchup'

type AlgoHandler = (ctx: AppContext, params: QueryParams, requesterDid: string) => Promise<OutputSchema>

const algos: Record<string, AlgoHandler> = {
  [catchup.shortname]: <AlgoHandler>catchup.handler,
}

export default algos
