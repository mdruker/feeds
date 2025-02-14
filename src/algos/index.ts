import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as catchup from './catchup'
import * as catchupAll from './catchup-all'

type AlgoHandler = (ctx: AppContext, params: QueryParams, requesterDid: string) => Promise<OutputSchema>

const algos: Record<string, AlgoHandler> = {
  [catchup.shortname]: <AlgoHandler>catchup.handler,
  [catchupAll.shortname]: <AlgoHandler>catchupAll.handler
}

export default algos
