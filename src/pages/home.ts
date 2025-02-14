import { html } from '../lib/view'
import { shell } from './shell'

type Props = {
  didHandleMap: Record<string, string>
  profile?: { displayName?: string }
}

export function home(props: Props) {
  return shell({
    title: 'Home',
    content: content(props),
  })
}

function content({ didHandleMap, profile }: Props) {
  return html`<div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>[alpha] Feedgen</h1>
      <p>Testing and configs</p>
    </div>
    <div class="container">
      <div class="card">
        ${profile
          ? html`<form action="/logout" method="post" class="session-form">
              <div>
                <button type="submit">Log out</button>
              </div>
            </form>`
          : html`<div class="session-form">
              <div>
                <a href="/login" class="button">Log in</a>
              </div>
            </div>`}
      </div>
    </div>
  </div>`
}
