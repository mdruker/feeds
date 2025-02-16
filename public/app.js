async function loadUserData() {
  try {
    const response = await fetch('/api/me')
    if (response.status === 401) {
      showLoginView()
      return
    }

    const data = await response.json()
    document.getElementById('user-handle').textContent = data.handle

    // Set radio button values
    document.getElementById('include_replies_true').checked = data.settings.include_replies
    document.getElementById('include_replies_false').checked = !data.settings.include_replies

    showSettingsView()
  } catch (error) {
    console.error('Error loading user data:', error)
    showLoginView()
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

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const include_replies = form.include_replies.value === 'true'

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ include_replies })
    })
    document.getElementById('settings-success').textContent = 'Settings updated'
    setTimeout(() => {
      document.getElementById('settings-success').textContent = ''
    }, 5000)
  } catch (error) {
    console.error('Error saving settings:', error)
    // Optionally show an error message
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

// Load initial data
loadUserData()