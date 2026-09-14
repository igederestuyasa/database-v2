import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    /**
     * `components/**` is in this list on purpose.
     *
     * Not every file under `components/` is a React component: `revisionDiff.ts`
     * and `strukturNodes.ts` are pure logic with no JSX, no hooks and no
     * database, and they are exactly the kind of code that is cheap to test and
     * expensive to get quietly wrong (a `key_hash` rendered into a diff, a uuid
     * shown where a nama belongs). Until now they were uncollectable, so their
     * authors verified them with throwaway scripts nobody can run again.
     *
     * Only `*.test.ts` is collected, never `*.test.tsx`: there is no jsdom and
     * no testing-library here and no dependency may be added (ADR-005 §1), so
     * rendering tests are out of reach. What a component *says* and *decides*
     * is still testable by pulling it into a plain module —
     * `tests/mergeDialog.test.ts` is the worked example.
     */
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["node_modules/**", ".next/**"],
  },
});
