import { html } from '../../lib/view'
import { shell } from './shell'
import { CatchupSettings } from '../../algos/catchup-common'

type Props = {
  handle: string
  settings: CatchupSettings
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
        <h2>Catchup Settings</h2>
        <form action="/settings" method="post" class="settings-form">
          <div class="form-group">
            Replies (experimental)<br>
            <input type="radio" id="include_replies_false" name="include_replies" value="false">
            <label for="include_replies_false">No replies</label>
            <input type="radio" id="include_replies_true" name="include_replies" value="true">
            <label for="include_replies_true">Include replies</label><br>
          </div>
          <div>
            <button type="submit">Save Settings</button>
          </div>
        </form>
      </div>

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