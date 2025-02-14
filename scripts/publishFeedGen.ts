import dotenv from 'dotenv'
import { AtpAgent, BlobRef } from '@atproto/api'
import fs from 'fs/promises'
import { ids } from '../src/lexicon/lexicons'
import { input, password } from '@inquirer/prompts'

const run = async () => {
  dotenv.config()

  if (!process.env.FEEDGEN_PUBLISHER_HANDLE) {
    throw new Error('Please provide a publisher handle in the corresponding .env file')
  }

  if (!process.env.FEEDGEN_HOSTNAME) {
    throw new Error('Please provide a hostname in the corresponding .env file')
  }

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
    message: 'Enter a short name or the record. This will be shown in the feed\'s URL:',
    validate: (value) => value.length > 0
  })

  const displayName = await input({
    message: 'Enter a display name for your feed',
    validate: (value) => value.length > 0
  })

  const description = await input({
    message: 'Optionally, enter a brief description of your feed:',
  })

  const avatar = await input({
    message: 'Optionally, enter a local path to an avatar that will be used for the feed:',
  })

  const feedGenDid = `did:web:${process.env.FEEDGEN_HOSTNAME}`

  // only update this if in a test environment
  const agent = new AtpAgent({ service: service ? service : 'https://bsky.social' })
  await agent.login({ identifier: process.env.FEEDGEN_PUBLISHER_HANDLE, password: userPassword})

  let avatarRef: BlobRef | undefined
  if (avatar) {
    let encoding: string
    if (avatar.endsWith('png')) {
      encoding = 'image/png'
    } else if (avatar.endsWith('jpg') || avatar.endsWith('jpeg')) {
      encoding = 'image/jpeg'
    } else {
      throw new Error('expected png or jpeg')
    }
    const img = await fs.readFile(avatar)
    const blobRes = await agent.api.com.atproto.repo.uploadBlob(img, {
      encoding,
    })
    avatarRef = blobRes.data.blob
  }

  await agent.api.com.atproto.repo.putRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyFeedGenerator,
    rkey: recordName,
    record: {
      did: feedGenDid,
      displayName: displayName,
      description: description,
      avatar: avatarRef,
      createdAt: new Date().toISOString(),
    },
  })

  console.log('All done 🎉')
}

run()
