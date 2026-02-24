import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    },
    server: {
        port: 5173,
        host: true,
    },
    preview: {
        port: 4173,
        host: true,
    },
});
