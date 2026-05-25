import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  
  // 构建优化：代码分割
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search'],
          tiptap: ['@tiptap/core', '@tiptap/react', '@tiptap/starter-kit'],
        },
      },
    },
  },
  
  // 依赖预构建优化
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@mui/material',
      '@xterm/xterm',
    ],
  },
  
  server: {
    port: 1501,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1502,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/logs/**", "**/.data/**"],
    },
  },
  envDir: ".",
}));
