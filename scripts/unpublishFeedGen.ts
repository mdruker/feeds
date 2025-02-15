import dotenv from 'dotenv'
import { AtpAgent, BlobRef } from '@atproto/api'
import fs from 'fs/promises'
import { ids } from '../src/lexicon/lexicons'
import { input, password, confirm } from '@inquirer/prompts'

const run = async () => {
  dotenv.config()

  if (!process.env.FEEDGEN_PUBLISHER_HANDLE) {
    throw new Error('Please provide a publisher handle in the corresponding .env file')
  }
  if (!process.env.FEEDGEN_PUBLISHER_PDS) {
    throw new Error('Please provide a publisher PDS in the corresponding .env file')
  }

  const userPassword = await password({
    message: `Enter a Bluesky app password for ${process.env.FEEDGEN_PUBLISHER_HANDLE}:`
  })

  const recordName = await input({
    message: 'Enter the short name for the record you want to delete:',
    validate: (value) => value.length > 0
  })

  const confirmed = await confirm({
    message: 'Are you sure you want to delete this record? Any likes that your feed has will be lost:',
    default: false
  })

  if (!confirmed) {
    console.log('Aborting...')
    return
  }

  // only update this if in a test environment
  const agent = new AtpAgent({ service: process.env.FEEDGEN_PUBLISHER_PDS })
  await agent.login({ identifier: process.env.FEEDGEN_PUBLISHER_HANDLE, password: userPassword })

  await agent.com.atproto.repo.deleteRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyFeedGenerator,
    rkey: recordName,
  })

  console.log('All done 🎉')
}

run()