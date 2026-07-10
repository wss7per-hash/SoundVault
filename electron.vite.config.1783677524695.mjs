// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["better-sqlite3"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [react()],
    css: {
      postcss: {
        plugins: [tailwindcss, autoprefixer]
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
