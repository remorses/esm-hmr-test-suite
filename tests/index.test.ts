import { traverseEsModules, urlResolver } from 'es-module-traversal'
import { once } from 'events'
import { exec, spawn } from 'child_process'
import execa from 'execa'
import fs from 'fs-extra'
import path from 'path'
import { URL } from 'url'
import WebSocket from 'ws'

const tempDir = path.resolve('temp')
const fixtureDir = path.resolve('hmr-test-app')
const PORT = 4000

jest.setTimeout(100000)

type TestCase = {
    name?: string
    path: string
    expectedMessagesCount?: number
    replacer: (content: string) => string
}

process.env.NODE_ENV = 'development'

const testCases: TestCase[] = [
    {
        path: 'src/main.jsx',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
    {
        path: 'src/file.jsx',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
    {
        path: 'src/file.css',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
    {
        path: 'src/file.module.css',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
    {
        path: 'src/file.json',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
    {
        path: 'src/file2.js',
        replacer: (content) => {
            return content + '\n\n'
        },
    },
]

beforeAll(async () => {
    try {
        await fs.remove(tempDir)
    } catch (e) {}
    await fs.ensureDir(tempDir)
    await fs.copy(fixtureDir, tempDir, {
        filter: (file) => !/dist|node_modules/.test(file),
    })
    const json = JSON.parse(
        fs.readFileSync(path.resolve(fixtureDir, 'package.json')).toString(),
    )
    fs.writeFileSync(
        path.resolve(tempDir, 'package.json'),
        JSON.stringify({ ...json, name: 'temp' }, null, 4),
    )
    await execa('yarn', { cwd: tempDir, stdio: 'inherit' })
})

afterAll(async () => {
    try {
        await fs.remove(tempDir)
    } catch (e) {}
})

async function start(type) {
    console.info('starting')
    switch (type) {
        case 'snowpack': {
            let resolve
            let complete = new Promise((r) => {
                resolve = r
            })
            const p = spawn(`yarn snowpack dev --port ${PORT}`, {
                cwd: tempDir,
                stdio: 'pipe',
                env: {
                    ...process.env,
                    NODE_ENV: 'development',
                },
                shell: true,
            })
            function onData(data) {
                process.stdout.write(data + '\n')
                if (data.includes('Server started')) {
                    console.log('complete')
                    resolve()
                }
            }
            p.stderr.on('data', onData)
            p.stdout.on('data', onData)
            await complete
            await sleep(300)
            return {
                stop: () => p.kill('SIGTERM'),
                entry: '/snowpack/index.html',
                hmrAgent: 'esm-hmr',
            }
        }
        case 'vite': {
            let resolve
            let complete = new Promise((r) => {
                resolve = r
            })
            const p = spawn(`yarn vite serve --port ${PORT}`, {
                cwd: tempDir,
                stdio: 'pipe',
                env: {
                    ...process.env,
                    NODE_ENV: 'development',
                },
                shell: true,
            })
            function onData(data) {
                process.stdout.write(data + '\n')
                if (data.includes('Dev server running at:')) {
                    console.log('complete')
                    resolve()
                }
            }
            p.stderr.on('data', onData)
            p.stdout.on('data', onData)
            await complete
            await sleep(400)
            return {
                stop: () => p.kill('SIGTERM'),
                entry: '/vite/index.html',
                hmrAgent: 'vite-hmr',
            }
        }
        default: {
            throw new Error(`${type} not handled`)
        }
    }
}

describe('hmr', () => {
    const baseUrl = `http://localhost:${PORT}`

    const root = tempDir

    const types = ['snowpack', 'vite']

    for (let type of types) {
        let stop
        let entry
        let hmrAgent

        for (let testCase of testCases) {
            test(type + ' ' + (testCase.name || testCase.path), async () => {
                try {
                    void ({ stop, entry, hmrAgent } = await start(type))
                    const traversedFiles = await traverseEsModules({
                        entryPoints: [new URL(entry, baseUrl).toString()],
                        resolver: urlResolver({
                            root,
                            baseUrl,
                        }),
                    })
                    // console.log(traversedFiles.map((x) => x.importPath))
                    const messages = await getWsMessages({
                        hmrAgent,
                        doing: async () => {
                            await updateFile(
                                path.resolve(root, testCase.path),
                                testCase.replacer,
                            )
                        },
                        expectedMessagesCount: testCase.expectedMessagesCount,
                    })
                    expect(messages.map(normalizeHmrMessage)).toMatchSnapshot()
                } finally {
                    stop && stop()
                    await sleep(300)
                }
            })
        }
    }
})

async function updateFile(compPath, replacer) {
    try {
        const content = await fs.readFile(compPath, 'utf-8')
        await fs.writeFile(compPath, replacer(content))
    } catch (e) {
        throw new Error(`could not update ${compPath}: ${e}`)
    }
}

async function getWsMessages({
    doing,
    expectedMessagesCount = Infinity,
    timeout = 800,
    port = PORT,
    hmrAgent,
}) {
    const ws = new WebSocket(`http://localhost:${port}`, hmrAgent)
    await once(ws, 'open')
    await doing()
    const messages = []
    ws.addEventListener('message', ({ data }) => {
        const payload = JSON.parse(data)
        if (payload.type === 'connected') return
        if (payload.type === 'multi') {
            return messages.push(...payload.updates)
        }
        return messages.push(payload)
    })
    await Promise.race([
        waitUntil(() => messages.length === expectedMessagesCount),
        sleep(timeout),
    ])
    ws.close()
    await once(ws, 'close')
    return messages
}

const sleep = (n) => new Promise((r) => setTimeout(r, n))

async function waitUntil(check) {
    while (!check()) {
        await sleep(50)
    }
}

const normalizeHmrMessage = (message) => {
    const ignoreKeys = ['timestamp']
    const validKeys = Object.keys(message).filter(
        (k) => !ignoreKeys.includes(k),
    )
    return Object.assign({}, ...validKeys.map((k) => ({ [k]: message[k] })))
}
