/**
 * Test setup file
 *
 * This file is preloaded before all tests run.
 * Use it to set up global mocks, environment variables, etc.
 */

// Plain output in every terminal: chalk colours text when tests run in a TTY, which breaks
// string assertions. Spawned CLI processes inherit this too.
process.env.FORCE_COLOR = "0";

// Ensure tests don't accidentally use real credentials
process.env.BENTO_API_KEY = "test-api-key";
process.env.BENTO_SITE_ID = "test-site-id";
