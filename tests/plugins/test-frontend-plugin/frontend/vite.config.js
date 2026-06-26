import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const copyManifest = {
  name: 'copy-manifest',
  closeBundle() {
    try {
      mkdirSync(resolve(__dirname, '../test_frontend_plugin/frontend_dist'), { recursive: true })
      copyFileSync(
        resolve(__dirname, 'package.json'),
        resolve(__dirname, '../test_frontend_plugin/frontend_dist/package.json')
      )
    } catch (e) {
      console.warn('Could not copy package.json to dist:', e.message)
    }
  },
}

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'test_frontend_plugin',
      filename: 'remoteEntry.js',
      dts: false,
      exposes: {
        './index': './src/index.jsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.2.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.2.0' },
      },
    }),
    copyManifest,
  ],
  build: {
    target: 'esnext',
    outDir: '../test_frontend_plugin/frontend_dist',
    emptyOutDir: true,
  },
})
