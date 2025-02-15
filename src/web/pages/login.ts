import { html } from '../../lib/view'
import { shell } from './shell'

type Props = { error?: string }

export function login(props: Props) {
  return shell({
    title: 'Log in',
    content: content(props),
  })
}

function content({ error }: Props) {
  return html`<div id="root">
    <div id="header">
      <h1>feeds.mdruker.app</h1>
    </div>
    <div class="container">
      Please login via bsky.social to access settings:
      <form action="/login" method="post" class="login-form">
        <input
          type="text"
          name="handle"
          placeholder="Enter your handle (eg alice.bsky.social)"
          required
        />
        <button type="submit">Log in</button>
        ${error ? html`<p>Error: <i>${error}</i></p>` : undefined}
      </form>
    </div>
  </div>`
}
