import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  
  // Use relative paths for cross-platform compatibility (Tauri WebView)
  // This ensures assets work correctly in production builds on Windows/macOS/Linux
  base: '',
  
  // 构建优化：代码分割
  build: {
    // Tauri 2.0 跨平台目标：
    // - Windows WebView2: Chromium 105+ (支持 esnext 全部特性)
    // - macOS/Linux WebKit: Safari 16+ (支持 esnext 全部特性)
    // 使用 esnext 让 Vite 不转译语法，由 WebView 自己处理
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep React + MUI together to avoid vendor <-> mui circular chunk init failures
          'react-vendor': [
            'react',
            'react-dom',
            'react-router-dom',
            '@mui/material',
            '@emotion/react',
            '@emotion/styled',
          ],
          phosphor: ['@phosphor-icons/react'],
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
    esbuildOptions: {
      target: 'esnext',
    },
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
