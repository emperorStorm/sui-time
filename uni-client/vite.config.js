import { defineConfig } from 'vite'
import uniPackage from '@dcloudio/vite-plugin-uni'

const uni = uniPackage.default || uniPackage

export default defineConfig({
  plugins: [uni()]
})
