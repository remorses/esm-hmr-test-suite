import React from 'react'
import { Comp, x } from './file'
import './file.css'
import json from './file.json'
import css from './file.module.css'

export function App() {
    return (
        <React.StrictMode>
            <Comp />
            {x}

            <pre>{JSON.stringify({ json, css })}</pre>
        </React.StrictMode>
    )
}
