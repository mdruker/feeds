import dotenv from 'dotenv'
import { AtpAgent, BlobRef } from '@atproto/api'
import fs from 'fs/promises'
import { ids } from '../src/lexicon/lexicons'
import { input, password, confirm } from '@inquirer/prompts'

const run = async () => {
  dotenv.config()

  const handle = await input({
    message: 'Enter your Bluesky handle',
    validate: (value) => value.length > 0
  })

  const userPassword = await password({
    message: 'Enter your Bluesky password (preferably an App Password):'
  })

  const service = await input({
    message: 'Optionally, enter a custom PDS service to sign in with:',
    default: 'https://bsky.social'
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
  const agent = new AtpAgent({ service: service })
  await agent.login({ identifier: handle, password: userPassword })

  await agent.api.com.atproto.repo.deleteRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyFeedGenerator,
    rkey: recordName,
  })

  console.log('All done 🎉')
}

run()