import dotenv from 'dotenv'
import FeedGenerator from './server'
import { Env } from './lib/env'

const run = async () => {
  if (!process.env.ENVIRONMENT) {
    process.env.ENVIRONMENT = Env.development
  }
  dotenv.config({path: '.env.' + process.env.ENVIRONMENT})

  const server = FeedGenerator.create({
    port: maybeInt(process.env.FEEDGEN_PORT)!!,
    listenhost: process.env.FEEDGEN_LISTENHOST as string,
    publisherDid: process.env.FEEDGEN_PUBLISHER_DID as string,
    hostname: process.env.FEEDGEN_HOSTNAME as string,
    serviceDid: `did:web:${(process.env.FEEDGEN_HOSTNAME as string)}`,
  })
  console.log(`cfg:`,{
    port: server.cfg.port,
    listenhost: server.cfg.listenhost,
    hostname: server.cfg.hostname,
    serviceDid: server.cfg.serviceDid,
    publisherDid: server.cfg.publisherDid,
  })

  await server.start()
  console.log(
    `🤖 running feed generator at http://${server.cfg.listenhost}:${server.cfg.port}`,
  )

  // Drain on signals so a deploy's `docker stop` doesn't cut in-flight requests.
  // The hard timeout is a backstop in case a drain hangs; keep it under the
  // container's stop grace period so we exit cleanly before SIGKILL.
  const drain = (signal: string) => {
    const force = setTimeout(() => {
      console.error('drain timed out — forcing exit')
      process.exit(1)
    }, 15000)
    force.unref()
    server
      .shutdown(signal)
      .then(() => { clearTimeout(force); process.exit(0) })
      .catch((err) => { console.error('shutdown error:', err); process.exit(1) })
  }
  process.on('SIGTERM', () => drain('SIGTERM'))
  process.on('SIGINT', () => drain('SIGINT'))
}

const maybeInt = (val?: string) => {
  if (!val) return undefined
  const int = parseInt(val, 10)
  if (isNaN(int)) return undefined
  return int
}

run()
