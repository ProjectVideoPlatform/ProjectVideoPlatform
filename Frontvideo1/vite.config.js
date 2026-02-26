import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    appType: 'spa', // ✅ ทำให้ Vite รู้ว่าเป็น Single Page App
      base: '/', 
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      open: false,
    },
    preview: {
      port: 4173,
      strictPort: true,
    }
})
