import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/*.test.ts"] } },
      // Drives the built dist/sherpa through its pipes; run after `bun run build`.
      {
        extends: true,
        test: { name: "stdio", include: ["tests/stdio/*.test.ts"], testTimeout: 20_000 },
      },
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
