import React from 'react'
import { App } from './bridge'
import ReactDOM from 'react-dom'

ReactDOM.render(<App />, document.getElementById('root'))

if (import.meta.hot) {
    import.meta.hot.accept()
}
