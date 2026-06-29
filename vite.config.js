import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8080'

  return {
    plugins: [
      vue(),
      vueDevTools(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    server: {
      proxy: {
        '/api/ws': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          xfwd: true,
          configure(proxy) {
            proxy.on('error', (error) => {
              console.error('[vite] websocket proxy error:', error.message)
            })
          }
        },
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true
        }
      }
    }
  }
})
