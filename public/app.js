async function loadUserData() {
  try {
    const response = await fetch('/api/me')
    if (response.status === 401) {
      showLoginView()
      return
    }

    const data = await response.json()
    document.getElementById('user-handle').textContent = data.handle

    // Set settings values
    document.getElementById('include_replies_true').checked = data.settings.include_replies
    document.getElementById('include_replies_false').checked = !data.settings.include_replies
    document.getElementById('posts_per_account').value = data.settings.posts_per_account
    document.getElementById('repost_percent').value = data.settings.repost_percent
    document.getElementById('num_recent_posts').value = data.settings.num_recent_posts

    showSettingsView()

    await loadActorScores()
  } catch (error) {
    console.error('Error loading user data:', error)
    showLoginView()
  }
}

async function resolveDidToHandle(did) {
  try {
    const response = await fetch(`https://bsky.social/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`)
    if (response.ok) {
      const data = await response.json()
      return data.handle || null
    }
  } catch (error) {
    console.warn('Failed to resolve DID to handle:', did, error)
  }
  return null
}

async function resolveMultipleDidsToHandles(dids) {
  const handleMap = {}
  
  const promises = dids.map(async (did) => {
    const handle = await resolveDidToHandle(did)
    handleMap[did] = handle
  })
  
  await Promise.all(promises)
  return handleMap
}

async function loadActorScores() {
  try {
    const response = await fetch('/api/actor-scores')
    const data = await response.json()
    
    const scoresList = document.getElementById('scores-list')
    
    if (data.actorScores && data.actorScores.length > 0) {
      // Show loading state
      scoresList.innerHTML = data.actorScores.map(score => `
        <div class="score-item" data-did="${score.did}">
          <div class="score-info">
            <span class="score-handle">Loading...</span>
            <span class="score-value ${score.score > 0 ? 'positive' : 'negative'}">${score.score > 0 ? '+' : ''}${score.score}</span>
          </div>
          <div class="score-actions">
            <button class="secondary-button edit-score" data-did="${score.did}" data-score="${score.score}" disabled>Edit</button>
            <button class="secondary-button remove-score" data-did="${score.did}">Remove</button>
          </div>
        </div>
      `).join('')
      
      // Resolve DIDs to handles
      const dids = data.actorScores.map(score => score.did)
      const handleMap = await resolveMultipleDidsToHandles(dids)
      
      // Update with resolved handles
      scoresList.innerHTML = data.actorScores.map(score => {
        const handle = handleMap[score.did]
        const displayName = handle ? `@${handle}` : score.did
        return `
          <div class="score-item" data-did="${score.did}">
            <div class="score-info">
              <span class="score-handle">${displayName}</span>
              <span class="score-value ${score.score > 0 ? 'positive' : 'negative'}">${score.score > 0 ? '+' : ''}${score.score}</span>
            </div>
            <div class="score-actions">
              <button class="secondary-button edit-score" data-did="${score.did}" data-handle="${handle}" data-score="${score.score}">Edit</button>
              <button class="secondary-button remove-score" data-did="${score.did}">Remove</button>
            </div>
          </div>
        `
      }).join('')
      
      // Add event listeners
      scoresList.querySelectorAll('.edit-score').forEach(btn => {
        btn.addEventListener('click', handleEditScore)
      })
      
      scoresList.querySelectorAll('.remove-score').forEach(btn => {
        btn.addEventListener('click', handleRemoveScore)
      })
    } else {
      scoresList.innerHTML = '<div class="empty-state">No account overrides set</div>'
    }
  } catch (error) {
    console.error('Error loading actor scores:', error)
  }
}

function showLoginView() {
  document.getElementById('login-view').style.display = 'block'
  document.getElementById('settings-view').style.display = 'none'
}

function showSettingsView() {
  document.getElementById('login-view').style.display = 'none'
  document.getElementById('settings-view').style.display = 'block'
}

// Form handlers
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const handle = form.handle.value

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ handle })
    })

    if (response.redirected) {
      window.location.href = response.url
    } else {
      const data = await response.json()
      document.getElementById('login-error').textContent = data.error || 'Login failed'
    }
  } catch (error) {
    console.error('Error during login:', error)
    document.getElementById('login-error').textContent = 'Login failed'
  }
})

// Function to show the toast message
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('show', 'error');

  // If it's an error, add error class
  if (isError) {
    toast.classList.add('error');
  }

  // Show the toast
  toast.classList.add('show');

  // Hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const include_replies = formData.get('include_replies') === 'true';
  const repost_percent = formData.get('repost_percent')
  const num_recent_posts = formData.get('num_recent_posts')

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        include_replies: include_replies,
        posts_per_account: document.getElementById('posts_per_account').value, // Get from separate input
        repost_percent: repost_percent,
        num_recent_posts: num_recent_posts,
      })
    })
    showToast('Settings updated', false);
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Failed to save settings', true);
  }
})

// Handle separate save button for default posts per account
document.getElementById('save-default').addEventListener('click', async () => {
  const postsPerAccount = document.getElementById('posts_per_account').value
  
  if (!postsPerAccount || postsPerAccount < 0 || postsPerAccount > 100) {
    showToast('Posts per account must be between 0 and 100', true)
    return
  }

  try {
    // Get current settings first
    const response = await fetch('/api/me')
    if (!response.ok) {
      throw new Error('Failed to get current settings')
    }
    
    const data = await response.json()
    const currentSettings = data.settings
    
    // Update just the posts_per_account
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        include_replies: currentSettings.include_replies,
        posts_per_account: parseInt(postsPerAccount),
        repost_percent: currentSettings.repost_percent,
        num_recent_posts: currentSettings.num_recent_posts,
      })
    })
    
    showToast('Default posts per account updated')
  } catch (error) {
    console.error('Error saving default posts per account:', error)
    showToast('Failed to save default setting', true)
  }
})

document.getElementById('logout-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await fetch('/logout', { method: 'POST' })
    window.location.reload()
  } catch (error) {
    console.error('Error during logout:', error)
  }
})

// Real-time handle lookup functionality
let lookupTimeout = null
let currentLookupDid = null

// Enhanced profile lookup using public Bluesky API
async function lookupProfile(handle) {
  try {
    // First resolve handle to DID
    const resolveResponse = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)
    
    if (!resolveResponse.ok) {
      throw new Error('Handle not found')
    }
    
    const resolveData = await resolveResponse.json()
    const did = resolveData.did
    
    if (!did) {
      throw new Error('Invalid DID response')
    }
    
    // Get full profile info using public API
    const profileResponse = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?actors=${encodeURIComponent(did)}`)
    
    if (!profileResponse.ok) {
      throw new Error('Profile not found')
    }
    
    const profileData = await profileResponse.json()
    
    if (!profileData.profiles || profileData.profiles.length === 0) {
      throw new Error('Profile not found in response')
    }
    
    const profile = profileData.profiles[0]
    
    // Check current score (if user follows this account)
    let currentScore, follows
    
    try {
      const followResponse = await fetch('/api/check-follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did })
      })
      
      if (followResponse.ok) {
        const followData = await followResponse.json()
        currentScore = followData.currentScore
        follows = followData.follows
      }
    } catch (error) {
      throw new Error("Couldn't reach server to validate follow relationship")
    }
    
    return {
      did,
      handle: profile.handle,
      displayName: profile.displayName,
      avatar: profile.avatar,
      currentScore,
      follows
    }
  } catch (error) {
    throw error
  }
}

function showProfilePreview(profile) {
  const preview = document.getElementById('profile-preview')
  const avatar = document.getElementById('profile-avatar')
  const name = document.getElementById('profile-name')
  const handleDisplay = document.getElementById('profile-handle-display')
  const currentScore = document.getElementById('current-score')
  
  preview.className = 'profile-preview'
  preview.style.display = 'flex'
  
  // Show avatar if available
  if (profile.avatar) {
    avatar.style.display = 'block'
    avatar.src = profile.avatar
  } else {
    avatar.style.display = 'none'
    avatar.src = ''
  }
  avatar.alt = profile.displayName || profile.handle
  
  name.textContent = profile.displayName || profile.handle
  handleDisplay.textContent = `@${profile.handle}`
  
  // Show follow status and current score
  const followStatus = profile.follows ? `Following (current score: ${profile.currentScore})` : 'Not following'
  currentScore.textContent = followStatus
  
  // Pre-fill current score if user follows this account
  if (profile.follows) {
    document.getElementById('score-value').value = profile.currentScore
  } else {
    document.getElementById('score-value').value = 0
  }
  
  currentLookupDid = profile.did
}

function showProfileError(message) {
  const preview = document.getElementById('profile-preview')
  const name = document.getElementById('profile-name')
  
  preview.className = 'profile-preview error'
  preview.style.display = 'flex'
  
  document.getElementById('profile-avatar').src = ''
  name.textContent = message
  document.getElementById('profile-handle-display').textContent = ''
  document.getElementById('current-score').textContent = '0'
  
  currentLookupDid = null
}

function hideProfilePreview() {
  document.getElementById('profile-preview').style.display = 'none'
  currentLookupDid = null
}

// Handle input with debounced lookup
document.getElementById('score-handle').addEventListener('input', async (e) => {
  const handle = e.target.value.trim()
  
  if (lookupTimeout) {
    clearTimeout(lookupTimeout)
  }
  
  if (!handle) {
    hideProfilePreview()
    return
  }
  
  // Basic format check
  if (!handle.includes('.') || handle.includes(' ') || handle.length < 4) {
    hideProfilePreview()
    return
  }
  
  // Show loading state
  const preview = document.getElementById('profile-preview')
  preview.className = 'profile-preview loading'
  preview.style.display = 'flex'
  document.getElementById('profile-name').textContent = 'Looking up...'
  document.getElementById('profile-handle-display').textContent = `@${handle}`
  document.getElementById('profile-avatar').style.display = 'none'
  document.getElementById('profile-avatar').src = ''

  // Debounced lookup after 500ms
  lookupTimeout = setTimeout(async () => {
    try {
      const profile = await lookupProfile(handle)
      showProfilePreview(profile)
    } catch (error) {
      console.warn('Profile lookup failed:', error)
      showProfileError('Handle not found')
    }
  }, 500)
})

document.getElementById('add-score-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  
  const handle = document.getElementById('score-handle').value.trim()
  const scoreValue = parseInt(document.getElementById('score-value').value)
  
  if (!handle) {
    showToast('Please enter a handle', true)
    return
  }
  
  if (!currentLookupDid) {
    showToast('Please wait for handle lookup to complete', true)
    return
  }
  
  if (isNaN(scoreValue) || scoreValue < -100 || scoreValue > 100) {
    showToast('Score must be between -100 and 100', true)
    return
  }
  
  try {
    const response = await fetch('/api/actor-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: currentLookupDid, score: scoreValue })
    })
    
    if (response.ok) {
      showToast('Actor score updated successfully')
      
      // Reset form
      document.getElementById('add-score-form').reset()
      hideProfilePreview()
      
      // Reload scores
      await loadActorScores()
    } else {
      const data = await response.json()
      showToast(data.error, true)
    }
  } catch (error) {
    console.error('Error updating score:', error)
    showToast('Error updating score', true)
  }
})

async function handleEditScore(event) {
  const button = event.target
  const did = button.dataset.did
  const handle = button.dataset.handle
  const currentScore = parseInt(button.dataset.score)
  
  const newScore = prompt(`Enter new score for @${handle}:`, currentScore)
  
  if (newScore === null) return // Cancelled
  
  const score = parseInt(newScore)
  if (isNaN(score) || score < -100 || score > 100) {
    showToast('Score must be between -100 and 100', true)
    return
  }
  
  try {
    const response = await fetch('/api/actor-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, score })
    })
    
    if (response.ok) {
      showToast('Score updated successfully')
      await loadActorScores()
    } else {
      const data = await response.json()
      showToast(data.error, true)
    }
  } catch (error) {
    console.error('Error updating score:', error)
    showToast('Error updating score', true)
  }
}

async function handleRemoveScore(event) {
  const button = event.target
  const did = button.dataset.did
  const scoreItem = button.closest('.score-item')
  const handle = scoreItem.querySelector('.score-handle').textContent
  
  if (!confirm(`Remove override for ${handle}?`)) return
  
  try {
    const response = await fetch('/api/actor-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, score: 0 })
    })
    
    if (response.ok) {
      showToast('Override removed successfully')
      await loadActorScores()
    } else {
      const data = await response.json()
      showToast(data.error, true)
    }
  } catch (error) {
    console.error('Error removing score:', error)
    showToast('Error removing score', true)
  }
}

// Load initial data
loadUserData()