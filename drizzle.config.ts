import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? process.env.DATABASE_URL!,
    ssl: (process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "").includes("vercel-storage.com")
      ? "require"
      : undefined,
  },
});
