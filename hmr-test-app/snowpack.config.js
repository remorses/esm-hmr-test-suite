module.exports = {
    mount: {
        public: '/',
        src: '/_dist_',
    },
    devOptions: {
        open: 'none',
    },
    plugins: [
        '@snowpack/plugin-react-refresh', // live reloading
    ],
}
