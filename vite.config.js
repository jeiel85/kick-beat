import { defineConfig } from 'vite';

// 상대 경로 base: GitHub Pages(/kick-beat/)든 로컬 정적 서버든 같은 빌드가 동작한다.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
