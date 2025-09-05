// Load user data and verify admin access
async function loadUserData() {
  try {
    const response = await fetch('/api/me')
    if (response.status === 401) {
      window.location.href = '/?error=unauthorized'
      return
    }

    const data = await response.json()
    document.getElementById('user-handle').textContent = data.handle

  } catch (error) {
    console.error('Error loading user data:', error)
    window.location.href = '/?error=unauthorized'
  }
}

// Function to show toast messages
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('show', 'error');

  if (isError) {
    toast.classList.add('error');
  }

  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Timeline form handler
document.getElementById('timeline-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const handle = form.handle.value.trim()
  
  if (!handle) {
    showToast('Please enter a handle', true)
    return
  }
  
  // Open in new tab
  window.open(`/showTimeline/${encodeURIComponent(handle)}`, '_blank')
})

// Feed form handler  
document.getElementById('feed-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const shortname = form.shortname.value
  const handle = form.handle.value.trim()
  
  if (!shortname || !handle) {
    showToast('Please select a feed algorithm and enter a handle', true)
    return
  }
  
  // Open in new tab
  window.open(`/showFeed/${encodeURIComponent(shortname)}/${encodeURIComponent(handle)}`, '_blank')
})

// Populate actor form handler
document.getElementById('populate-actor-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const didsText = form.dids.value.trim()
  
  if (!didsText) {
    showToast('Please enter at least one DID', true)
    return
  }
  
  const dids = didsText.split('\n').map(did => did.trim()).filter(did => did)
  
  if (dids.length === 0) {
    showToast('Please enter at least one valid DID', true)
    return
  }
  
  // Validate DIDs
  for (const did of dids) {
    if (!did.startsWith('did:')) {
      showToast(`Invalid DID format: ${did}. DIDs must start with "did:"`, true)
      return
    }
  }
  
  try {
    const response = await fetch('/jobs/populate-actor/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dids })
    })
    
    if (response.ok) {
      showToast(`${dids.length} populate-actor job(s) created successfully`)
      form.reset()
    } else {
      const data = await response.json()
      showToast(`Error creating jobs: ${data.error}`, true)
    }
  } catch (error) {
    console.error('Error creating populate-actor jobs:', error)
    showToast('Error creating jobs', true)
  }
})

// Logout form handler
document.getElementById('logout-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await fetch('/logout', { method: 'POST' })
    window.location.href = '/'
  } catch (error) {
    console.error('Error during logout:', error)
    showToast('Error during logout', true)
  }
})

// News post form handler
document.getElementById('news-post-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const postUri = form.post_uri.value.trim()
  const shortname = form.shortname.value
  
  if (!postUri || !shortname) {
    showToast('Please enter a post URI and select a feed', true)
    return
  }
  
  if (!postUri.startsWith('at://')) {
    showToast('Post URI must start with "at://"', true)
    return
  }
  
  try {
    const response = await fetch('/api/news-post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ post_uri: postUri, shortname })
    })
    
    if (response.ok) {
      const data = await response.json()
      showToast(`News post created for ${data.count} actors`)
      form.reset()
    } else {
      const data = await response.json()
      showToast(`Error creating news post: ${data.error}`, true)
    }
  } catch (error) {
    console.error('Error creating news post:', error)
    showToast('Error creating news post', true)
  }
})

// Load initial data
loadUserData()