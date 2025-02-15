import { html } from '../../lib/view'
import { shell } from './shell'

type Props = {
  handle: string
}

export function home(props: Props) {
  return shell({
    title: 'Home',
    content: content(props),
  })
}

function content(props: Props) {
  return html`<div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>feeds.mdruker.app</h1>
      <p>Feed settings</p>
    </div>
    <div class="container">
      Logged in as ${props.handle}
      <div class="card">
        <form action="/logout" method="post" class="session-form">
          <div>
            <button type="submit">Log out</button>
          </div>
        </form>
      </div>
    </div>
  </div>`
}
