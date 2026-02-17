import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), "");
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const env = { ...rootEnv, ...frontendEnv };
  const kakaoMapJsKey = env.KAKAO_MAP_JS_KEY
    || env.VITE_KAKAO_JS_KEY
    || env.VITE_KAKAO_REST_API_KEY
    || env.KAKAO_REST_API_KEY
    || process.env.KAKAO_MAP_JS_KEY
    || process.env.KAKAO_REST_API_KEY
    || process.env.VITE_KAKAO_JS_KEY
    || process.env.VITE_KAKAO_REST_API_KEY
    || "";

  return {
    plugins: [react()],
    define: {
      __KAKAO_MAP_JS_KEY__: JSON.stringify(kakaoMapJsKey),
    },
    root: __dirname,
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  };
});
