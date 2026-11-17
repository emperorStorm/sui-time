import { defineConfig } from 'vite'
import uniPackage from '@dcloudio/vite-plugin-uni'

const uni = uniPackage.default || uniPackage

export default defineConfig({
  plugins: [uni()],
  define: { __SUI_DIAG__: JSON.stringify(process.env.SUI_DIAG === '1') }
})
