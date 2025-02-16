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
  const posts_per_account = formData.get('posts_per_account')

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        include_replies: include_replies,
        posts_per_account: posts_per_account,
      })
    })
    showToast('Settings updated', false);
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Failed to save settings', true);
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