import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5173,
        host: true,
    },
    preview: {
        port: 4173,
        host: true,
    },
    build: {
        /** Generate source maps for production debugging */
        sourcemap: true,
        /** Target modern browsers for smaller output */
        target: 'es2020',
        /** Split vendor chunks for better caching */
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-query': ['@tanstack/react-query'],
                    'vendor-ui': ['lucide-react', 'react-hot-toast', 'clsx', 'tailwind-merge'],
                    'vendor-editor': ['slate', 'slate-react'],
                    'vendor-export': ['jspdf', 'docx', 'file-saver'],
                },
            },
        },
        /** Warn on large chunks */
        chunkSizeWarningLimit: 500,
    },
});
